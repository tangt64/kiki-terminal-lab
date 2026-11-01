import { PRODUCT_ID, PRODUCT_VERSION } from "../platform/shared/product.js";
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { ROOT } from './config.js';
import { PostgresSessions,publicUser } from './db.js';
import { createVault } from './secrets.js';
import { OPERATIONS,operationLabel,validateOperation,requireOwnedInstance } from './cloud.js';
import { problem,text,cidr,quotaForRequest,validatedSettings,integer } from './policy.js';

const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const saveSession=req=>new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
function validPassword(value){if(typeof value!=='string'||value.length<12||Buffer.byteLength(value,'utf8')>72)throw problem(400,'비밀번호는 12자 이상, UTF-8 기준 72바이트 이하로 입력하세요.');return value;}
const safeEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};

export async function createApplication({db,cloud,config,sessionStore,terminals,publicRoutes}){
  const app=express();
  const cookieName=config.secureCookie?'__Host-tl.community.sid':'tl.community.sid';
  const vault=createVault(config.credentialKey);
  const dummyHash=await bcrypt.hash(randomBytes(24).toString('hex'),12);
  const attempts=new Map();
  app.disable('x-powered-by');
  if(config.trustProxy)app.set('trust proxy',1);
  if(publicRoutes)app.use(publicRoutes.middleware());
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
    next();
  });
  app.use(express.json({limit:'32kb'}));
  const sessions=session({name:cookieName,secret:config.sessionSecret,store:sessionStore||new PostgresSessions(db),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:config.secureCookie,maxAge:8*60*60*1000}});
  app.use(sessions);
  app.use('/api',(req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    if(req.get('origin')&&req.get('origin')!==config.publicUrl)return next(problem(403,'허용되지 않은 요청 출처입니다.'));
    if(!safeEqual(req.get('x-csrf-token'),req.session.csrfToken)||!req.session.csrfToken)return next(problem(403,'요청 토큰이 만료되었습니다. 화면을 새로고침하세요.'));
    next();
  });
  const auth=wrap(async(req,res,next)=>{
    if(!req.session.userId)throw problem(401,'로그인이 필요합니다.');
    req.user=await db.user(req.session.userId);
    if(!req.user||req.user.status!=='approved')throw problem(403,'승인된 계정만 사용할 수 있습니다.');
    next();
  });
  const admin=wrap(async(req,res,next)=>{if(req.user.role!=='admin')throw problem(403,'관리자 권한이 필요합니다.');next();});
  function rateLimit(req){
    const now=Date.now();for(const [key,bucket]of attempts)if(bucket.until<now)attempts.delete(key);
    const key=req.ip;const bucket=attempts.get(key)||{count:0,until:now+15*60*1000};
    if(++bucket.count>20)throw problem(429,'시도가 너무 많습니다. 15분 후 다시 시도하세요.');
    attempts.set(key,bucket);
  }
  app.get('/api/health',wrap(async(req,res)=>{await db.query('SELECT 1');res.json({ok:true,product:PRODUCT_ID,version:PRODUCT_VERSION});}));
  app.get('/api/auth/csrf',wrap(async(req,res)=>{req.session.csrfToken ||= randomBytes(32).toString('hex');await saveSession(req);res.json({csrfToken:req.session.csrfToken});}));
  app.get('/api/auth/me',wrap(async(req,res)=>{
    const user=req.session.userId?await db.user(req.session.userId):null;
    res.json({user:user?.status==='approved'?publicUser(user):null});
  }));
  app.post('/api/auth/login',wrap(async(req,res)=>{
    rateLimit(req);
    const username=text(req.body.username,'아이디',64).toLowerCase();
    const password=String(req.body.password||'').slice(0,201);
    const user=await db.userByName(username);
    if(!await bcrypt.compare(password,user?.passwordHash||dummyHash)||!user)throw problem(401,'아이디 또는 비밀번호를 확인하세요.');
    if(user.status!=='approved')throw problem(403,'관리자 승인이 필요하거나 비활성화된 계정입니다.');
    await regenerate(req);req.session.userId=user.id;req.session.csrfToken=randomBytes(32).toString('hex');await saveSession(req);
    await db.audit(user.id,'auth.login');
    res.json({user:publicUser(user),csrfToken:req.session.csrfToken});
  }));
  app.post('/api/auth/signup',wrap(async(req,res)=>{
    rateLimit(req);const username=text(req.body.username,'아이디',64).toLowerCase();
    if(!/^[a-z][a-z0-9_.-]{2,63}$/.test(username))throw problem(400,'아이디는 영문자로 시작하는 영문·숫자 3~64자입니다.');
    const user=await db.createUser({username,name:text(req.body.name,'이름',80),email:req.body.email?text(req.body.email,'이메일',254):'',passwordHash:await bcrypt.hash(validPassword(req.body.password),12)});
    await db.audit(user.id,'auth.signup');res.status(201).json({message:'가입 요청이 등록되었습니다. 관리자 승인 후 로그인하세요.'});
  }));
  app.post('/api/auth/logout',auth,wrap(async(req,res)=>{await new Promise((resolve,reject)=>req.session.destroy(error=>error?reject(error):resolve()));res.clearCookie(cookieName,{path:'/',secure:config.secureCookie});res.json({ok:true});}));
  app.patch('/api/profile',auth,wrap(async(req,res)=>{
    const patch={name:text(req.body.name,'이름',80),email:req.body.email?text(req.body.email,'이메일',254):''};
    if(req.body.password){if(!await bcrypt.compare(String(req.body.currentPassword||''),req.user.passwordHash))throw problem(403,'현재 비밀번호를 확인하세요.');patch.passwordHash=await bcrypt.hash(validPassword(req.body.password),12);}
    const user=await db.patchUser(req.user.id,patch);await db.audit(req.user.id,'profile.update');res.json({user:publicUser(user),reauthenticate:Boolean(patch.passwordHash)});
  }));
  app.get('/api/settings',auth,wrap(async(req,res)=>res.json({settings:{...await db.settings(),...publicRoutes?.capabilities()}})));
  app.get('/api/admin/users',auth,admin,wrap(async(req,res)=>res.json({users:(await db.users()).map(publicUser)})));
  app.patch('/api/admin/users/:id',auth,admin,wrap(async(req,res)=>{
    const patch={};
    if(req.body.role!==undefined){if(!['user','admin'].includes(req.body.role))throw problem(400,'역할이 잘못되었습니다.');patch.role=req.body.role;}
    if(req.body.status!==undefined){if(!['pending','approved','disabled'].includes(req.body.status))throw problem(400,'상태가 잘못되었습니다.');patch.status=req.body.status;}
    if(req.body.selfServiceVmEnabled!==undefined){if(typeof req.body.selfServiceVmEnabled!=='boolean')throw problem(400,'권한 값이 잘못되었습니다.');patch.selfServiceVmEnabled=req.body.selfServiceVmEnabled;}
    if(req.body.password)patch.passwordHash=await bcrypt.hash(validPassword(req.body.password),12);
    const id=integer(req.params.id,'사용자 번호',1,Number.MAX_SAFE_INTEGER);
    const user=await db.patchUser(id,patch);if(!user)throw problem(404,'사용자를 찾지 못했습니다.');
    await db.audit(req.user.id,'user.update',{userId:id,fields:Object.keys(patch)});res.json({user:publicUser(user)});
  }));
  app.patch('/api/admin/settings',auth,admin,wrap(async(req,res)=>{
    const settings=validatedSettings(req.body,await db.settings());await db.saveSettings(settings);await db.audit(req.user.id,'settings.update',{fields:Object.keys(req.body)});res.json({settings});
  }));
  app.get('/api/admin/audit-logs',auth,admin,wrap(async(req,res)=>res.json({logs:await db.auditLogs()})));

  function presentAction(action,user){
    const result={...action.result};const secret=result.accessCredentialsEncrypted;delete result.accessCredentialsEncrypted;
    if(secret&&action.userId===user.id)result.accessCredentials=vault.decrypt(secret);
    return {...action,result};
  }
  async function projectFor(user,projectName){
    if(user.role!=='admin'&&!user.selfServiceVmEnabled)throw problem(403,'클라우드 사용 권한이 필요합니다.');
    const projects=await db.projects(user.role==='admin'?null:user.id);
    const project=projects.find(p=>p.projectName===projectName&&p.status==='approved');
    if(!project)throw problem(403,'승인된 본인 프로젝트를 선택하세요.');return project;
  }
  async function executeProject(project,reviewer){
    if(project.result?.phase==='deleting')throw problem(409,'삭제 중 실패한 프로젝트입니다. 구성을 재실행할 수 없습니다. 인프라 상태를 확인하세요.');
    const claimed=await db.claimProject(project.id,['requested','failed'],'provisioning',reviewer);
    if(!claimed)throw problem(409,'이미 처리 중인 프로젝트 요청입니다.');
    try{
      const result=await cloud.provision(claimed);
      if(result?.ok===false)throw problem(502,'OpenStack 프로젝트 구성이 완료되지 않았습니다.');
      const updated=await db.updateProject(project.id,'approved',result||{});
      await db.patchUser(project.userId,{selfServiceVmEnabled:true});await db.audit(reviewer,'project.approve',{projectId:project.id});return updated;
    }catch(error){await db.updateProject(project.id,'failed',{phase:'provisioning'},'구성 실패. 실제 OpenStack 자원을 확인한 뒤 재시도하세요.');throw error;}
  }
  app.get('/api/cloud-console/project',auth,wrap(async(req,res)=>{const projectRequests=await db.projects(req.user.id);res.json({projectRequests,projectRequest:projectRequests.find(p=>!['deleted','rejected'].includes(p.status))||null});}));
  app.get('/api/admin/projects',auth,admin,wrap(async(req,res)=>res.json({projectRequests:await db.projects()})));
  app.post('/api/cloud-console/project',auth,wrap(async(req,res)=>{
    const settings=await db.settings();
    const {quota,quotaProfileId}=quotaForRequest(req.body,settings);
    const config={networkName:text(req.body.networkName,'네트워크 이름',80),subnetCidr:cidr(req.body.subnetCidr),quota,quotaProfileId,externalNetworkName:settings.selfServiceVmProjectExternalNetworkName};
    const existing=(await db.projects(req.user.id)).find(p=>!['deleted','rejected'].includes(p.status));
    if(existing)return res.json({projectRequest:existing,automaticallyApproved:existing.status==='approved'});
    // Name is allocated by the server; existing infrastructure is never adopted by an arbitrary client value.
    let project=await db.createProject(req.user.id,`community-user-${req.user.id}-${randomBytes(4).toString('hex')}`,config);
    const automatic=settings.selfServiceVmProjectAutoApproveEnabled;
    if(automatic)project=await executeProject(project,req.user.id);
    res.status(automatic?201:202).json({projectRequest:project,automaticallyApproved:automatic});
  }));
  app.post('/api/admin/projects/:id/review',auth,admin,wrap(async(req,res)=>{
    const project=await db.project(integer(req.params.id,'프로젝트 번호',1,Number.MAX_SAFE_INTEGER));if(!project)throw problem(404,'프로젝트 요청을 찾지 못했습니다.');
    if(req.body.action==='approve'){
      const owner=await db.user(project.userId);if(owner?.status!=='approved')throw problem(409,'승인된 사용자의 요청만 처리할 수 있습니다.');
      return res.json({projectRequest:await executeProject(project,req.user.id)});
    }
    if(req.body.action!=='reject')throw problem(400,'승인 또는 반려를 선택하세요.');
    if(project.status==='failed')throw problem(409,'실패한 요청은 자원이 남아 있을 수 있습니다. 인프라를 확인한 뒤 재시도하세요.');
    const claimed=await db.claimProject(project.id,['requested'],'rejected',req.user.id);if(!claimed)throw problem(409,'이미 처리된 요청입니다.');
    await db.audit(req.user.id,'project.reject',{projectId:project.id});res.json({projectRequest:claimed});
  }));
  app.delete('/api/cloud-console/project',auth,wrap(async(req,res)=>{
    const project=await projectFor(req.user,req.body.projectName);
    if(req.body.confirmProjectName!==project.projectName)throw problem(400,'프로젝트 이름 확인이 필요합니다.');
    const claimed=await db.claimProjectDeletion(project.id,req.user.id);if(!claimed)throw problem(409,'실행 중인 작업이 있거나 이미 삭제 중입니다.');
    try{const result=await cloud.deleteProject(claimed);if(result?.ok===false)throw problem(502,'프로젝트 삭제가 완료되지 않았습니다.');for(const route of await db.publicRoutes(project.projectName))await publicRoutes?.remove({projectName:project.projectName,serverId:route.serverId});await db.updateProject(project.id,'deleted',result||{});await db.audit(req.user.id,'project.delete',{projectId:project.id});res.json({ok:true});}
    catch(error){await db.updateProject(project.id,'failed',{phase:'deleting'},'삭제 실패. 실제 자원 상태를 관리자가 확인해야 합니다.');throw error;}
  }));
  app.get('/api/cloud-console/snapshot',auth,wrap(async(req,res)=>{
    const project=await projectFor(req.user,String(req.query.projectName||''));
    const snapshot=await cloud.snapshot(project.projectName);
    snapshot.publicRoutes=(await db.publicRoutes(project.projectName)).map(row=>publicRoutes?publicRoutes.present(row):row);
    res.json({snapshot});
  }));
  app.get('/api/cloud-console/actions',auth,wrap(async(req,res)=>res.json({actions:(await db.actions(req.user.role==='admin'?null:req.user.id)).map(a=>presentAction(a,req.user))})));
  async function executeAction(action,actor){
    const definition=OPERATIONS.find(([m,p])=>operationLabel(m,p)===action.operation);
    if(!definition)throw problem(400,'지원하지 않는 작업입니다.');
    const owner=await db.user(action.userId);if(owner?.status!=='approved')throw problem(403,'요청자의 계정이 활성 상태가 아닙니다.');
    const project=await projectFor(owner,action.projectName);
    const snapshot=await cloud.snapshot(project.projectName);
    const settings=await db.settings();
    const effectiveUser={...owner,role:action.request.adminRequested?'admin':owner.role};
    const body=validateOperation(definition[2],{...action.request,snapshot,user:effectiveUser,settings});
    const kind=definition[2];let result;
    if(['createSshForward','createPublicRoute','createTcpForward','deleteSshForward','deletePublicRoute','deleteTcpForward'].includes(kind)){
      if(!publicRoutes)throw problem(503,'외부 접속 기능을 사용할 수 없습니다.');
      const p=action.request.params;
      if(kind.startsWith('create'))result=await publicRoutes.create({projectName:project.projectName,server:requireOwnedInstance(snapshot,p.id,owner),user:owner,kind:kind==='createSshForward'?'ssh':kind==='createTcpForward'||body.mode==='tcp'?'tcp':'http',body});
      else result=await publicRoutes.remove({projectName:project.projectName,serverId:p.id,...(kind==='deleteSshForward'?{kind:'ssh'}:kind==='deleteTcpForward'?{port:p.externalPort}:p.subdomain?.startsWith('tcp-')?{port:p.subdomain.slice(4)}:{subdomain:p.subdomain})});
    }else{
      result=await cloud.execute(kind,{projectName:project.projectName,params:action.request.params,body,user:owner})||{};
      if(kind==='deleteInstance')await publicRoutes?.remove({projectName:project.projectName,serverId:action.request.params.id});
    }
    const stored={...result};
    if(stored.accessCredentials){stored.accessCredentialsEncrypted=vault.encrypt(stored.accessCredentials);delete stored.accessCredentials;}
    const updated=await db.updateAction(action.id,'completed',stored);
    await db.audit(actor.id,'cloud.execute',{actionId:action.id,operation:action.operation,projectName:project.projectName});
    return updated;
  }
  for(const [method,route,kind]of OPERATIONS){
    app[method.toLowerCase()]('/api/cloud-console'+route,auth,wrap(async(req,res)=>{
      const settings=await db.settings();
      const project=await projectFor(req.user,req.body.projectName);
      const body=validateOperation(kind,{body:req.body,params:req.params,snapshot:await cloud.snapshot(project.projectName),user:req.user,settings});
      const approvalRequired=req.user.role!=='admin'&&!settings.selfServiceVmAutoProvisionEnabled;
      let action=await db.createAction(req.user.role==='admin'?project.userId:req.user.id,project.projectName,operationLabel(method,route),{body,params:req.params,adminRequested:req.user.role==='admin'},approvalRequired?'requested':'executing');
      if(approvalRequired)return res.status(202).json({ok:true,approvalRequired:true,action:presentAction(action,req.user),message:'관리자 승인 대기로 등록했습니다.'});
      try{action=await executeAction(action,req.user);res.json({ok:true,action:presentAction(action,req.user),result:presentAction(action,req.user).result});}
      catch(error){await db.updateAction(action.id,'failed',{},'작업 실패. 실제 OpenStack 자원 상태를 확인하세요.');throw error;}
    }));
  }
  app.post('/api/admin/cloud-console/actions/:id/review',auth,admin,wrap(async(req,res)=>{
    if(!['approve','reject'].includes(req.body.action))throw problem(400,'승인 또는 반려를 선택하세요.');
    const action=await db.claimAction(integer(req.params.id,'작업 번호',1,Number.MAX_SAFE_INTEGER),req.user.id,req.body.action==='reject'?'rejected':'executing');
    if(!action)throw problem(409,'이미 처리된 작업입니다.');
    if(req.body.action==='reject'){await db.audit(req.user.id,'cloud.reject',{actionId:action.id});return res.json({action:presentAction(action,req.user)});}
    try{res.json({action:presentAction(await executeAction(action,req.user),req.user)});}
    catch(error){await db.updateAction(action.id,'failed',{},'승인 작업 실행 실패. 실제 자원을 확인하세요.');throw error;}
  }));
  app.post('/api/cloud-console/iso-images',auth,admin,wrap(async(req,res)=>{
    const project=await projectFor(req.user,String(req.query.projectName||''));
    if(!/^[a-f\d]{64}$/i.test(String(req.query.sha256||'')))throw problem(400,'SHA-256을 확인하세요.');
    const result=await cloud.uploadIso({projectName:project.projectName,name:text(req.query.name,'ISO 이름'),expectedSha256:req.query.sha256,ownerUserId:project.userId,stream:req});
    await db.audit(req.user.id,'image.upload',{projectName:project.projectName,imageId:result.id});res.status(201).json({result});
  }));
  app.post('/api/cloud-console/instances/:id/console',auth,wrap(async(req,res)=>{
    if(!terminals)throw problem(503,'콘솔 연결을 사용할 수 없습니다.');
    const project=await projectFor(req.user,req.body.projectName);requireOwnedInstance(await cloud.snapshot(project.projectName),req.params.id,req.user);
    const result=await cloud.console(project.projectName,req.params.id);
    res.json(await terminals.vnc(req,result.url||result.console?.url||result.remote_console?.url));
  }));
  app.post('/api/cloud-console/instances/:id/terminal/session',auth,wrap(async(req,res)=>{
    if(!terminals)throw problem(503,'SSH 터미널 연결을 사용할 수 없습니다.');
    const project=await projectFor(req.user,req.body.projectName);
    const server=requireOwnedInstance(await cloud.snapshot(project.projectName),req.params.id,req.user);
    res.json(await terminals.ssh(req,{server,username:text(req.body.username,'SSH 사용자명',64),password:text(req.body.password,'SSH 비밀번호',200)}));
  }));
  app.delete('/api/cloud-console/terminal/sessions/:id',auth,wrap(async(req,res)=>{terminals?.close(req.params.id,req.user.id);res.json({ok:true});}));

  app.use('/api',(req,res)=>res.status(404).json({message:'제공하지 않는 API입니다.'}));
  const dist=path.join(ROOT,'dist');
  if(fs.existsSync(dist)){
    app.use(express.static(dist,{index:false,maxAge:'1h'}));
    app.get(['/','/admin','/profile','/console'],(req,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(path.join(dist,'index.html'));});
  }
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const status=error.code==='23505'?409:(error.statusCode||error.status||500);
    if(status>=500)console.error('[community]',req.method,req.path,error.code||error.name);
    res.status(status>=400&&status<=599?status:500).json({message:error.code==='23505'?'이미 등록된 요청 또는 아이디입니다.':status>=500?'요청을 처리하지 못했습니다. 관리자에게 자원 상태 확인을 요청하세요.':error.message});
  });
  return {app,sessions,projectFor};
}

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createHmac,randomBytes,sign,verify,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isIP} from 'node:net';
import {projectApi,importIso,ensureValidationSecurityGroup} from './kiki-cloud-openstack.js';
import {createIsoServer,completeIsoServer} from './iso-vm.js';

const ARTIFACT_ORIGIN='https://cloud-7-3b778824-09936d.apps.example.com';
const terminal=new Set(['passed','failed','needs-review']);
const error=(text,statusCode=400)=>Object.assign(Error(text),{statusCode});
const hash=data=>createHash('sha256').update(data).digest('hex');
const same=(a,b)=>/^[a-f0-9]{64}$/.test(a||'')&&/^[a-f0-9]{64}$/.test(b||'')&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const safeId=id=>/^[a-f0-9]{32}$/.test(id||'');
export function verifyMachineRequest(config,req,now=Date.now()){
 const stamp=req.get('X-Kiki-Time'),nonce=req.get('X-Kiki-Nonce'),provided=req.get('X-Kiki-Signature');
 if(!/^\d{10}$/.test(stamp||'')||Math.abs(now/1000-Number(stamp))>300||!safeId(nonce))throw error('Machine authentication required',401);
 const body=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
 const signed=[req.method,req.originalUrl,stamp,nonce,hash(body)].join('\n');
 if(!/^[a-f0-9]{128}$/.test(provided||'')||!verify(null,Buffer.from(signed),config.clientPublicKey,Buffer.from(provided,'hex')))throw error('Machine authentication failed',401);
 return {nonce,stamp};
}
export function validateBuild(value){
 if(value?.schema!=='kiki-cloud-build-v1'||!safeId(value.job_id)||!/^[a-f0-9]{64}$/.test(value.iso_sha256||''))throw error('Invalid build identity');
 if(!Number.isSafeInteger(value.iso_bytes)||value.iso_bytes<32774||value.iso_bytes>8*1024**3)throw error('Invalid ISO size');
 if(!Array.isArray(value.parts)||!value.parts.length||value.parts.length>32||value.parts.some(p=>!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<=0||p.bytes>256*1024**2)||value.parts.reduce((n,p)=>n+p.bytes,0)!==value.iso_bytes)throw error('Invalid ISO parts');
 const e=value.expected;
 if(e?.profile!=='desktop-gnome'||!/^[a-f0-9]{64}$/.test(e.catalog_sha256||'')||!/^[a-f0-9]{64}$/.test(e.security_policy_sha256||''))throw error('Invalid install selection');
 if(!e.packages||Object.keys(e.packages).length<10||Object.keys(e.packages).length>512||Object.entries(e.packages).some(([n,h])=>!/^[a-zA-Z0-9][a-zA-Z0-9+_.-]{0,95}$/.test(n)||!/^[a-f0-9]{64}$/.test(h)))throw error('Invalid package hashes');
 if(!e.critical_files||Object.keys(e.critical_files).length>256||Object.entries(e.critical_files).some(([p,h])=>!/^\/(?:usr|etc|boot)\/[a-zA-Z0-9/_.+-]+$/.test(p)||p.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(h)))throw error('Invalid critical file hashes');
 return value;
}
export function verifyInstallMarker(output,job){
 const matches=[...String(output).matchAll(/KIKI_CLOUD_INSTALL_RESULT ([A-Za-z0-9+/=]+)\.([a-f0-9]{64})/g)];
 for(const match of matches.reverse()){
  const payload=Buffer.from(match[1],'base64');
  if(!same(match[2],createHmac('sha256',Buffer.from(job.reportSecret,'hex')).update(payload).digest('hex')))continue;
  const result=JSON.parse(payload.toString());
  if(result.status==='installed'&&result.job_id===job.id&&result.iso_sha256===job.manifest.iso_sha256&&result.volume_id===job.volumeId&&result.catalog_sha256===job.manifest.expected.catalog_sha256&&/^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$/.test(result.ssh_host_key||''))return result;
 }
 return null;
}

export async function pollInstallCompletion(api,job,now=Date.now()){
 if(now-Date.parse(job.installStartedAt)>2*3600000)throw error('Unattended install timed out; VM preserved',504);
 const server=(await api('compute','/servers/'+job.installerId)).server;
 if(server.status==='ERROR')throw error('Installer VM entered ERROR',409);
 if(!['ACTIVE','SHUTOFF'].includes(server.status))return null;
 let console;
 try{console=await api('compute','/servers/'+job.installerId+'/action',{method:'POST',body:{'os-getConsoleOutput':{length:300}}});}
 catch(e){if(e.statusCode===409||/not ready/.test(e.message))return null;throw e;}
 if(/KIKI_CLOUD_INSTALL_FAILED|Cloud installation failed\./.test(console.output||''))throw error('Unattended installer failed; inspect preserved VM serial console',409);
 const installed=verifyInstallMarker(console.output,job);
 return installed&&server.status==='SHUTOFF'?installed:null;
}

async function atomic(file,value){
 const temp=file+'.'+randomBytes(8).toString('hex');
 await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,file);
}
async function exec(command,args,{input='',timeout=120000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='',err='',size=0;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(error('Validation command timed out',504));},timeout);timer.unref();
  child.stdout.on('data',b=>{size+=b.length;if(size>4*1024**2){child.kill('SIGKILL');return;}out+=b;});
  child.stderr.on('data',b=>{if(err.length<20000)err+=b;});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function* downloadParts(manifest){
 for(const part of manifest.parts){
  const url=ARTIFACT_ORIGIN+'/ki2/build-iso/'+manifest.job_id+'/'+part.sha256+'.part';
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(300000)});
  if(!response.ok||Number(response.headers.get('content-length'))!==part.bytes)throw error('ISO artifact unavailable',502);
  const digest=createHash('sha256');let bytes=0;
  for await(const block of response.body){bytes+=block.length;if(bytes>part.bytes)throw error('ISO part size mismatch',502);digest.update(block);yield block;}
  if(bytes!==part.bytes||digest.digest('hex')!==part.sha256)throw error('ISO part SHA mismatch',502);
 }
}

export function createKikiIsoAutomation({dataRoot,isPrimary,withLock,configureCloud,configPath=path.join(dataRoot,'kiki-iso-private/config.json')}){
 const root=path.join(dataRoot,'kiki-iso-jobs');let busy=false;
 const dir=id=>path.join(root,id),file=id=>path.join(dir(id),'state.json');
 const read=async id=>JSON.parse(await fs.readFile(file(id),'utf8'));
 const save=async j=>{j.updatedAt=new Date().toISOString();await atomic(file(j.id),j);};
 const publicJob=j=>({schema:'kiki-openstack-validation-v1',id:j.id,status:j.status,phase:j.phase,iso_sha256:j.manifest.iso_sha256,projectName:j.projectName,installerVmId:j.installerId||null,runtimeVmId:j.runtimeId||null,targetVolumeId:j.volumeId||null,createdAt:j.createdAt,updatedAt:j.updatedAt,error:j.error||null,reports:j.reports||[],bootIds:(j.reports||[]).map(r=>r.boot_id),configurationScan:j.reports?.at(-1)?.scap?.summary||null,guiLoginTested:false});
 const config=async()=>{const c=JSON.parse(await fs.readFile(configPath,'utf8'));if(!c.enabled||!c.clientPublicKey?.includes('BEGIN PUBLIC KEY'))throw error('ISO automation disabled',503);return c;};
 async function setupKey(job){
  const key=path.join(dir(job.id),'guest-key');
  try{await fs.access(key);}catch{const result=await exec('ssh-keygen',['-q','-t','ed25519','-N','','-f',key]);if(result.code!==0)throw error('Validation key generation failed',500);}
  return (await fs.readFile(key+'.pub','utf8')).trim().split(' ').slice(0,2).join(' ');
 }
 async function seed(c,j,volumeId){
  const publicKey=await setupKey(j);
  const payload=Buffer.from(JSON.stringify({schema:'kiki-cloud-install-v1',job_id:j.id,iso_sha256:j.manifest.iso_sha256,volume_id:volumeId,disk_size_gb:c.diskSizeGb,
   expires_at:Math.floor(Date.now()/1000)+21600,username:j.username,password:j.password,hostname:'kiki-'+j.id.slice(0,12),profile:j.manifest.expected.profile,
   packages:Object.keys(j.manifest.expected.packages),catalog_sha256:j.manifest.expected.catalog_sha256,ssh_public_key:publicKey,report_secret:j.reportSecret}));
  return JSON.stringify({schema:'kiki-cloud-install-envelope-v1',payload:payload.toString('base64'),signature:sign(null,payload,await fs.readFile(c.seedKey)).toString('base64')});
 }
 function sshArgs(j,ip){return ['-i',path.join(dir(j.id),'guest-key'),'-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+path.join(dir(j.id),'known_hosts'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=10',j.username+'@'+ip];}
 async function validateGuest(j,server){
  const candidates=Object.values(server.addresses||{}).flat().filter(a=>a.version===4&&a['OS-EXT-IPS:type']==='fixed').map(a=>a.addr);
  if(candidates.length!==1||isIP(candidates[0])!==4||!/^10\.250\./.test(candidates[0]))throw error('Validation guest address is ambiguous',409);
  const ip=candidates[0];await fs.writeFile(path.join(dir(j.id),'known_hosts'),ip+' '+j.installResult.ssh_host_key.split(' ').slice(0,2).join(' ')+'\n',{mode:0o600});
  const args=sshArgs(j,ip),ready=await exec('ssh',[...args,'true'],{timeout:15000});
  if(ready.code!==0){if(Date.now()-Date.parse(j.runtimeStartedAt)>15*60000)throw error('Installed VM SSH readiness failed',504);return null;}
  const expected={...j.manifest.expected,vm_id:j.runtimeId,iso_sha256:j.manifest.iso_sha256};
  let result=await exec('ssh',[...args,'umask 077; cat > /tmp/catalog-expected.json'],{input:JSON.stringify(expected)});
  if(result.code!==0)throw error('Guest expectation transfer failed',502);
  const script=await fs.readFile(new URL('./assets/kiki-cloud-guest-check.py',import.meta.url),'utf8');
  result=await exec('ssh',[...args,'umask 077; cat > /tmp/kiki-cloud-check.py'],{input:script});
  if(result.code!==0)throw error('Guest verifier transfer failed',502);
  result=await exec('ssh',[...args,'sudo -S -p "" /usr/bin/python3 /tmp/kiki-cloud-check.py'],{input:j.password+'\n',timeout:240000});
  if(result.code!==0)throw error('Guest verifier execution failed',502);
  const report=JSON.parse(result.out);
  if(report.vm_id!==j.runtimeId||report.iso_sha256!==j.manifest.iso_sha256||!report.checks||!Object.keys(report.checks).length)throw error('Guest report binding mismatch',502);
  return {report,args};
 }
 async function advance(c,j){
  await configureCloud();const cloud=await projectApi(j.projectName),{api}=cloud;
  if(j.status==='queued'){
   j.phase='ISO 다운로드·SHA 검증·Glance 등록';await save(j);
   const image=await importIso(cloud,j.manifest,downloadParts(j.manifest),dir(j.id),c.ownerUserId);
   j.imageId=image.id;j.status='creating';await save(j);
  }
  if(j.status==='creating'){
   const all=(await api('compute','/servers/detail')).servers;
   let server=all.find(s=>s.metadata?.terminal_lab_build_job_id===j.id&&s.metadata?.terminal_lab_user_id===String(c.ownerUserId));
   if(!server){
    if(j.createIntent)throw error('Nova creation response uncertain; inspect resources before retry',409);
    await ensureValidationSecurityGroup(api,c.securityGroupName);
    const image=await api('image','/v2/images/'+j.imageId);
    server=await createIsoServer(api,{name:'kiki-iso-'+j.id.slice(0,12),image,flavorId:c.flavorId,networkId:c.networkId,securityGroupNames:[c.securityGroupName],ownerUserId:c.ownerUserId,bootVolumeSizeGb:c.diskSizeGb,
     automation:{jobId:j.id,volumeId:j.volumeId,onVolume:async id=>{j.volumeId=id;await save(j);},seed:id=>seed(c,j,id),beforeCreate:async()=>{j.createIntent=true;await save(j);}}});
   }
   j.installerId=server.id;j.status='installing';j.phase='ISO 무인 설치';j.installStartedAt=new Date().toISOString();await save(j);
  }
  if(j.status==='installing'){
   const installed=await pollInstallCompletion(api,j);
   if(installed){
    j.installResult=installed;j.status='cutover';j.phase='설치 디스크 스냅샷·디스크 VM 전환';await save(j);
   }
  }
  if(j.status==='cutover'){
   const runtime=await completeIsoServer(api,{projectName:j.projectName,serverId:j.installerId,ownerUserId:c.ownerUserId,installationConfirmed:true});
   j.runtimeId=runtime.id;j.status='validating';j.phase='첫 디스크 부팅 검사';j.runtimeStartedAt=new Date().toISOString();await save(j);
  }
  if(j.status==='validating'||j.status==='rebooting'){
   const server=(await api('compute','/servers/'+j.runtimeId)).server;
   if(server.status==='ERROR')throw error('Runtime VM entered ERROR',409);
   if(server.status!=='ACTIVE')return;
   const value=await validateGuest(j,server);if(!value)return;
   const {report}=value;
   if(j.reports?.some(r=>r.boot_id===report.boot_id)){
    if(j.reports.length===1&&!j.rebootDispatched){
     await api('compute','/servers/'+j.runtimeId+'/action',{method:'POST',body:{reboot:{type:'SOFT'}}});
     j.rebootDispatched=true;await save(j);return;
    }
    if(Date.now()-Date.parse(j.rebootRequestedAt)>10*60000)throw error('Disk reboot did not produce a new boot ID',504);
    return;
   }
   j.reports=[...(j.reports||[]),report];
   if(report.status!=='passed'||Object.values(report.checks).some(v=>v!==true)){await save(j);throw error('Installed VM checks failed: '+Object.entries(report.checks).filter(([,v])=>v!==true).map(([n])=>n).join(', '),409);}
   if(j.reports.length===1){
    j.status='rebooting';j.phase='재부팅 후 동일 검사';j.rebootRequestedAt=new Date().toISOString();await save(j);
    await api('compute','/servers/'+j.runtimeId+'/action',{method:'POST',body:{reboot:{type:'SOFT'}}});
    j.rebootDispatched=true;await save(j);
   }else{j.status='passed';j.phase='두 차례 디스크 부팅·패키지·OpenSCAP 검증 통과';await save(j);}
  }
 }
 async function tick(){
  if(!isPrimary||busy)return;busy=true;
  try{
   const c=await config();await fs.mkdir(root,{recursive:true,mode:0o700});
   const ids=(await fs.readdir(root)).filter(safeId).sort();
   for(const id of ids){
    const j=await read(id);if(terminal.has(j.status))continue;
    await withLock(c.projectName,async()=>{
     try{await advance(c,j);}
     catch(e){j.status='needs-review';j.phase='검증 중단 · 자원 보존';j.error=String(e.message).replaceAll(j.password,'[redacted]').slice(0,500);await save(j);}
    });break;
   }
  }catch{/* Disabled or DB contention: retry on the next timer, never fabricate success. */}
  finally{busy=false;}
 }
 const router=express.Router();router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(express.raw({type:'application/json',limit:'1mb'}));
 router.use(async(req,res,next)=>{
  try{
   const c=await config();const {nonce,stamp}=verifyMachineRequest(c,req);
   const replay=path.join(dataRoot,'kiki-iso-private/nonces');await fs.mkdir(replay,{recursive:true,mode:0o700});
   try{await fs.writeFile(path.join(replay,stamp+'-'+nonce),'',{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw error('Replayed machine request',409);throw e;}
   req.kikiConfig=c;next();
  }catch(e){res.status(e.statusCode||503).json({message:e.statusCode?e.message:'ISO automation unavailable'});}
 });
 router.post('/',async(req,res)=>{
  try{
   const manifest=validateBuild(JSON.parse(req.body.toString('utf8'))),c=req.kikiConfig;
   const job=await withLock(c.projectName,async()=>{
    await fs.mkdir(root,{recursive:true,mode:0o700});
    try{const prior=await read(manifest.job_id);if(hash(JSON.stringify(prior.manifest))!==hash(JSON.stringify(manifest)))throw error('Build identity already has different inputs',409);return prior;}catch(e){if(e.code!=='ENOENT')throw e;}
    const active=[];for(const id of (await fs.readdir(root)).filter(safeId)){if(!terminal.has((await read(id)).status))active.push(id);}
    if(active.length>=(c.maxActiveJobs||1))throw error('Another ISO validation is active',409);
    await fs.mkdir(dir(manifest.job_id),{mode:0o700});
    const j={id:manifest.job_id,manifest,projectName:c.projectName,status:'queued',phase:'자동 배포 대기',username:'kiki',password:randomBytes(24).toString('base64url'),reportSecret:randomBytes(32).toString('hex'),createdAt:new Date().toISOString()};
    await save(j);return j;
   });res.status(202).json(publicJob(job));void tick();
  }catch(e){res.status(e.statusCode||400).json({message:e.statusCode?e.message:'Invalid build manifest'});}
 });
 router.get('/:id',async(req,res)=>{try{if(!safeId(req.params.id))throw error('Unknown build',404);res.json(publicJob(await read(req.params.id)));}catch(e){res.status(e.code==='ENOENT'?404:e.statusCode||500).json({message:'Build unavailable'});}});
 const timer=setInterval(()=>void tick(),15000);timer.unref();setTimeout(()=>void tick(),10000).unref();
 return {router,tick};
}

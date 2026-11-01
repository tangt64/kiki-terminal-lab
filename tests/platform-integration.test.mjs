import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const target=process.env.TEST_PLATFORM_DATABASE_URL;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function totp(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const char of secret)bits+=alphabet.indexOf(char).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',key).update(counter).digest();const offset=hash.at(-1)&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
test('full platform: SSO, OTP, notices, community posts and excluded features',{skip:!target,timeout:90000},async t=>{
  assert.match(new URL(target).pathname,/^\/community_test_[a-z0-9_]+$/);
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'community-parity-'));
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const child=spawn(process.execPath,['tests/platform-server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:origin,DATA_ROOT_DIR:data,SESSION_SECRET:'test-parity-session-'.repeat(4),CREDENTIAL_KEY:'cd'.repeat(32),INITIAL_ADMIN_USERNAME:'admin',INITIAL_ADMIN_PASSWORD:'parity-admin-test-password-2026',HEAT_DRIVER:'openstack',NODE_ENV:'development'}});
  let logs='';child.stdout.on('data',value=>logs+=value);child.stderr.on('data',value=>logs+=value);
  try{
    let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error(logs);try{const r=await fetch(origin+'/api/health');if(r.ok){ready=true;break;}}catch{}await delay(150);}
    assert.ok(ready,logs);
    function agent(){let cookie='';return async(endpoint,options={})=>{const response=await fetch(origin+endpoint,{method:options.method||'GET',redirect:'manual',headers:{cookie,origin,'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});const cookies=response.headers.getSetCookie();if(cookies.length)cookie=cookies.at(-1).split(';')[0];const contentType=response.headers.get('content-type')||'';const data=contentType.includes('json')?await response.json():await response.text();return {status:response.status,data,location:response.headers.get('location')};};}
    const admin=agent(),member=agent();let userId,otpSecret;
    const login=agent=>agent('/api/auth/login',{method:'POST',body:{username:'admin',password:'parity-admin-test-password-2026'}});
    await t.test('the active health endpoint identifies KIKI OS TERMINAL-LAB 0.3.0',async()=>{const result=await admin('/api/health');assert.equal(result.data.product,'kiki-terminal-lab');assert.equal(result.data.version,'0.3.0');});
    await t.test('original administrator account and user-management APIs work',async()=>{
      assert.equal((await login(admin)).status,200);
      const created=await admin('/api/admin/users',{method:'POST',body:{username:'member',name:'Community Member',email:'member@example.test',password:'parity-member-test-password-2026',role:'student',status:'approved'}});assert.equal(created.status,201,JSON.stringify(created.data));userId=created.data.user.id;
      assert.equal((await member('/api/auth/login',{method:'POST',body:{username:'member',password:'parity-member-test-password-2026'}})).status,200);
      assert.equal((await member('/api/admin/users')).status,403);
    });
    await t.test('notices and non-course Q&A preserve original create/read operations',async()=>{
      const notice=await admin('/api/admin/notices',{method:'POST',body:{title:'Platform notice',body:'General operations notice',isPinned:true}});assert.equal(notice.status,201);
      const listed=await member('/api/notices');assert.ok(listed.data.notices.some(n=>n.title==='Platform notice'));
      const post=await member('/api/qna',{method:'POST',body:{title:'Community question',body:'A general platform question',postType:'question'}});assert.equal(post.status,201,JSON.stringify(post.data));
      const posts=await member('/api/qna');assert.ok((posts.data.posts||posts.data.qna||[]).some(p=>p.title==='Community question'));
      const notifications=await admin('/api/notifications');assert.equal(notifications.status,200);assert.ok(notifications.data.notifications.some(item=>item.metadata?.postId===post.data.post.id),'Support-group notifications must reach the actual administrator account');
    });
    await t.test('lab board pages, APIs and assets are unavailable for every role',async()=>{
      for(const actor of [admin,member,agent()])for(const endpoint of ['/board','/board/legacy','/board-sandbox.html','/board-fonts/fonts/example.woff2','/board-icons/example.svg','/api/board-rooms/entry','/api/board-rooms/mine']){
        for(const method of ['GET','POST']){const result=await actor(endpoint,{method,...(method==='POST'?{body:{}}:{})});assert.equal(result.status,404,endpoint);assert.equal(result.data.code,'LAB_BOARD_NOT_INCLUDED',endpoint);}
      }
      assert.equal((await fs.readdir(data)).includes('board-rooms'),false);
    });
    await t.test('education endpoints are unavailable even to administrators',async()=>{
      for(const endpoint of ['/api/courses','/api/admin/courses','/api/admin/labs','/api/admin/lab-exam-attempts/export.csv','/certificate/example','/api/public/curricula','/api/admin/course-access/assign']){const result=await admin(endpoint);assert.equal(result.status,404,endpoint);}
    });
    await t.test('delegated administrator boundaries prevent every tested promotion path',async()=>{
      async function create(username,permissions=[],status='approved',role='student'){
        const result=await admin('/api/admin/users',{method:'POST',body:{username,name:'Synthetic account',email:'',password:'delegated-test-password-2026',role,status}});
        assert.equal(result.status,201,JSON.stringify(result.data));
        const id=result.data.user.id;
        if(permissions.length)assert.equal((await admin(`/api/admin/users/${id}/access`,{method:'PATCH',body:{role,status,adminPermissions:permissions}})).status,200);
        const call=agent();if(status==='approved')assert.equal((await call('/api/auth/login',{method:'POST',body:{username,password:'delegated-test-password-2026'}})).status,200);
        return {id,call};
      }
      const reader=await create('console_reader',['admin:access']);
      const manager=await create('user_manager',['admin:access','admin:users']);
      const ops=await create('ops_delegate',['admin:access','admin:ops']);
      const fullId=(await admin('/api/auth/session')).data.user.id;
      assert.equal((await reader.call('/api/admin/users')).status,200);
      for(const actor of [reader,manager]){
        for(const role of ['admin','administrator',' ADMIN ','관리자']){
          assert.equal((await actor.call(`/api/admin/users/${actor.id}/access`,{method:'PATCH',body:{role,status:'approved'}})).status,403,role);
          assert.equal((await actor.call('/api/admin/users',{method:'POST',body:{username:'blocked_'+actor.id,name:'Blocked',password:'test-password-2026',role,status:'approved'}})).status,403,role);
          assert.equal((await actor.call('/api/admin/users/batch-create',{method:'POST',body:{usernamePrefix:'blocked',password:'test-password-2026',startNumber:1,endNumber:2,role,status:'approved'}})).status,403,role);
        }
        assert.equal((await actor.call(`/api/admin/users/${actor.id}/access`,{method:'PATCH',body:{role:'student',status:'approved',adminPermissions:['admin:all']}})).status,403);
        for(const id of [fullId,ops.id])for(const suffix of ['reset-password','issue-reset-pin'])assert.equal((await actor.call(`/api/admin/users/${id}/${suffix}`,{method:'POST',body:{password:'blocked-password-2026'}})).status,403,suffix);
        assert.equal((await actor.call(`/api/admin/users/${fullId}`,{method:'DELETE'})).status,403);
        assert.equal((await actor.call(`/api/admin/users/${ops.id}/access`,{method:'PATCH',body:{role:'student',status:'pending'}})).status,403);
        for(const [endpoint,method]of [['/api/admin/backups/export','GET'],['/api/admin/backups/restore','POST']])assert.equal((await actor.call(endpoint,{method,body:method==='POST'?{}:undefined})).status,403);
        assert.equal((await actor.call('/api/auth/session')).data.user.role,'student');
      }
      for(const method of ['GET','POST'])assert.equal((await ops.call('/api/admin/backups/'+(method==='GET'?'export':'restore'),{method,body:method==='POST'?{}:undefined})).status,403);
      const ordinary=await manager.call('/api/admin/users',{method:'POST',body:{username:'managed_member',name:'Managed Member',email:'',password:'test-password-2026',role:'student',status:'pending'}});
      assert.equal(ordinary.status,201,JSON.stringify(ordinary.data));const ordinaryId=ordinary.data.user.id;
      assert.equal((await manager.call(`/api/admin/users/${ordinaryId}/access`,{method:'PATCH',body:{role:'student',status:'approved',selfServiceVmEnabled:true,supportMessageEnabled:true}})).status,200);
      assert.equal((await manager.call(`/api/admin/users/${ordinaryId}/reset-password`,{method:'POST',body:{password:'changed-member-password-2026'}})).status,200);
      assert.equal((await manager.call(`/api/admin/users/${ordinaryId}/issue-reset-pin`,{method:'POST',body:{}})).status,200);
      const pending=await create('pending_normal',[],'pending');const privileged=await create('pending_privileged',['admin:access'],'pending');
      assert.equal((await manager.call('/api/admin/users/bulk-approve',{method:'POST',body:{userIds:[pending.id,privileged.id]}})).status,403);
      assert.equal((await admin('/api/admin/users')).data.users.find(u=>u.id===pending.id).status,'pending','Bulk refusal must not partially approve');
      assert.equal((await manager.call('/api/admin/users/bulk-approve',{method:'POST',body:{userIds:[pending.id]}})).status,200);
      assert.equal((await manager.call(`/api/admin/users/${ordinaryId}`,{method:'DELETE'})).status,200);
      await settings({oauthGoogleClientSecret:'review-secret-canary',mailSmtpPassword:'review-smtp-canary'});
      const publicStatus=JSON.stringify((await reader.call('/api/platform-status')).data);assert.doesNotMatch(publicStatus,/review-secret-canary|review-smtp-canary/);
      assert.match(JSON.stringify((await admin('/api/platform-status')).data),/review-secret-canary/);
      assert.equal((await reader.call('/api/admin/platform-status',{method:'PUT',body:{llmEnabled:true}})).status,403);
      assert.equal((await admin('/api/admin/users',{method:'POST',body:{username:'full_admin_control',name:'Full admin control',email:'',password:'test-password-2026',role:'administrator',status:'approved'}})).status,201);
    });
    await t.test('residual education and share upgrades are unavailable without changing general terminals',async()=>{
      const provenance=JSON.parse(await fs.readFile(path.join(root,'platform/SOURCE-PROVENANCE.json'),'utf8'));
      for(const entry of provenance.removedEducationRoutes)for(const actor of [admin,member,agent()]){
        const method=entry.method.toUpperCase(),endpoint=entry.path.replace(/:[a-zA-Z0-9_]+/g,'1').replaceAll('*','example');
        assert.equal((await actor(endpoint,{method,body:['POST','PUT','PATCH'].includes(method)?{}:undefined})).status,404,endpoint);
      }
      for(const endpoint of ['/?popup=instructor-share&session=demo','/?popup=terminal','/?curriculum=2026','/terminal-popup'])assert.equal((await member(endpoint)).status,404,endpoint);
      const response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({username:'member',password:'parity-member-test-password-2026'})});
      const cookie=response.headers.getSetCookie().at(-1).split(';')[0];
      async function upgrade(endpoint){return new Promise((resolve,reject)=>{const req=http.request(origin+endpoint,{headers:{Cookie:cookie,Origin:origin,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}});req.on('upgrade',(res,socket)=>{resolve(res.statusCode);socket.destroy();});req.on('response',res=>{resolve(res.statusCode);res.resume();});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('upgrade timeout')));req.end();});}
      for(const endpoint of ['/ws/instructor-share/view/demo','/ws/instructor-share/publish/demo','/ws/%69nstructor-share/view/demo'])assert.equal(await upgrade(endpoint),404,endpoint);
      assert.equal(await upgrade('/ws/terminal/nonexistent-general-session'),401,'General terminal ownership guard must remain');
      const db=new pg.Client({connectionString:target});await db.connect();try{assert.equal(Number((await db.query('SELECT count(*) AS count FROM courses')).rows[0].count),0,'Blocked seeding must leave education tables empty');}finally{await db.end();}
      assert.equal((await admin('/api/admin/service-validation/openstack-lifecycle-test',{method:'POST',body:{}})).status,400,'Unconfigured general validation must refuse before infrastructure calls');
    });
    await t.test('general LLM questions retain answers without education context',async()=>{
      let received='';
      const llm=http.createServer((req,res)=>{req.on('data',chunk=>received+=chunk);req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Demo operational answer'}}]}));});});
      await new Promise(resolve=>llm.listen(0,'127.0.0.1',resolve));
      try{
      await settings({llmProvider:'custom',llmApiUrl:`http://127.0.0.1:${llm.address().port}/v1/chat/completions`,llmEnabled:true,llmModel:'demo-model',llmWebSearchEnabled:false});
      const result=await member('/api/llm/chat',{method:'POST',body:{question:'How do I inspect a VM network?',courseId:999999,history:[]}});
      assert.equal(result.status,200,JSON.stringify(result.data));assert.match(JSON.stringify(result.data),/Demo operational answer/);
      assert.match(received,/How do I inspect a VM network/);assert.doesNotMatch(received,/999999/);
      }finally{await new Promise(resolve=>llm.close(resolve));}
    });
    async function settings(patch){const current=await admin('/api/platform-status');const value=current.data.status||current.data.platformStatus||current.data;const changed=await admin('/api/admin/platform-status',{method:'PUT',body:{...value,...patch}});assert.equal(changed.status,200,JSON.stringify(changed.data));}
    await t.test('Google, Kakao and Naver SSO retain state checks and establish provider sessions',async()=>{
      await settings({signupAutoApproveEnabled:true,oauthEnabled:true,oauthGoogleEnabled:true,oauthGoogleClientId:'test-google',oauthGoogleClientSecret:'test-secret',oauthKakaoEnabled:true,oauthKakaoClientId:'test-kakao',oauthNaverEnabled:true,oauthNaverClientId:'test-naver',oauthNaverClientSecret:'test-secret'});
      for(const provider of ['google','kakao','naver']){
        const oauth=agent();const start=await oauth('/api/auth/oauth/'+provider);assert.equal(start.status,302,provider);const location=new URL(start.location);const state=location.searchParams.get('state');assert.ok(state);
        const callback=await oauth(`/api/auth/oauth/${provider}/callback?`+new URLSearchParams({state,code:'test-code'}));assert.equal(callback.status,302);assert.ok(!callback.location.includes('oauth=error'),callback.location);
        const session=await oauth('/api/auth/session');assert.equal(session.data.authenticated,true,JSON.stringify(session.data));assert.equal(session.data.user.email,provider+'@sso.example.test');
        const invalid=agent();const rejected=await invalid(`/api/auth/oauth/${provider}/callback?state=wrong&code=test-code`);assert.ok(rejected.location.includes('oauth=error'));
      }
    });
    await t.test('OTP enrollment, bad-code rejection and authenticated OTP login work',async()=>{
      await settings({otpUserEnabled:true});
      const setup=await member('/api/auth/otp/setup/start',{method:'POST',body:{}});assert.equal(setup.status,200,JSON.stringify(setup.data));otpSecret=setup.data.setup.secret;
      assert.equal((await member('/api/auth/otp/setup/confirm',{method:'POST',body:{code:'invalid'}})).status,400);
      assert.equal((await member('/api/auth/otp/setup/confirm',{method:'POST',body:{code:totp(otpSecret)}})).status,200);
      await member('/api/auth/logout',{method:'POST',body:{}});
      const challenge=await member('/api/auth/login',{method:'POST',body:{username:'member',password:'parity-member-test-password-2026'}});assert.equal(challenge.status,401);assert.equal(challenge.data.requiresOtp,true);
      const authenticated=await member('/api/auth/login',{method:'POST',body:{username:'member',password:'parity-member-test-password-2026',otpCode:totp(otpSecret)}});assert.equal(authenticated.status,200,JSON.stringify(authenticated.data));
    });
  }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);});await fs.rm(data,{recursive:true,force:true});}
});

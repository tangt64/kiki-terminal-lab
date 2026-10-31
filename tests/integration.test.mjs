import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Database } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { fakeCloud } from './fake-cloud.js';

const connectionString=process.env.TEST_DATABASE_URL;
test('fresh PostgreSQL: signup, RBAC, project approval, cloud approval and isolation',{skip:!connectionString},async t=>{
  const target=new URL(connectionString);
  assert.match(target.pathname,/^\/community_test_[a-z0-9_]+$/,'Only dedicated disposable community_test_* databases may be used');
  const db=new Database(connectionString);const cloud=fakeCloud();let server;
  const config={sessionSecret:'test-only-'.repeat(5),credentialKey:'ab'.repeat(32),publicUrl:'http://127.0.0.1',secureCookie:false,trustProxy:false};
  try{
    await db.migrate({username:'admin',name:'Test Administrator',password:'test-only-admin-password-2026'});
    const {app}=await createApplication({db,cloud,config});server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;config.publicUrl=base;
    function agent(){let cookie='',csrf='';return async(path,{method='GET',body,origin=base,omitCsrf=false}={})=>{
      const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),origin,...(body===undefined?{}:{'content-type':'application/json'}),...(!omitCsrf&&csrf?{'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      const set=response.headers.getSetCookie();if(set.length)cookie=set.at(-1).split(';')[0];
      const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;
      return {status:response.status,data};
    };}
    const admin=agent(),user=agent(),stranger=agent();let userId,projectName,projectId,serverId;
    await t.test('schema has no education tables',async()=>{
      const tables=await db.rows("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
      assert.equal(tables.some(row=>['courses','lab_requests','user_course_access','payments','certificates'].includes(row.tableName)),false);
    });
    await t.test('signup ignores privilege fields and pending accounts cannot log in',async()=>{
      await user('/api/auth/csrf');
      assert.equal((await user('/api/auth/signup',{method:'POST',body:{username:'member',name:'테스트 사용자',password:'test-only-member-password-2026',role:'admin',status:'approved',selfServiceVmEnabled:true}})).status,201);
      const row=await db.userByName('member');userId=row.id;assert.equal(row.role,'user');assert.equal(row.status,'pending');assert.equal(row.selfServiceVmEnabled,false);
      assert.equal((await user('/api/auth/login',{method:'POST',body:{username:'member',password:'test-only-member-password-2026'}})).status,403);
    });
    await t.test('admin approves the user and users cannot reach admin APIs',async()=>{
      await admin('/api/auth/csrf');assert.equal((await admin('/api/auth/login',{method:'POST',body:{username:'admin',password:'test-only-admin-password-2026'}})).status,200);
      assert.equal((await admin(`/api/admin/users/${userId}`,{method:'PATCH',body:{status:'approved'}})).status,200);
      const login=await user('/api/auth/login',{method:'POST',body:{username:'member',password:'test-only-member-password-2026'}});assert.equal(login.status,200);assert.equal(login.data.user.passwordHash,undefined);
      assert.equal((await user('/api/admin/users')).status,403);
      assert.equal((await stranger('/api/admin/users')).status,401);
    });
    await t.test('missing CSRF and cross-origin mutations are rejected',async()=>{
      assert.equal((await user('/api/cloud-console/project',{method:'POST',body:{},omitCsrf:true})).status,403);
      assert.equal((await user('/api/cloud-console/project',{method:'POST',body:{},origin:'https://attacker.example'})).status,403);
    });
    await t.test('only one concurrent project approval executes',async()=>{
      const request=await user('/api/cloud-console/project',{method:'POST',body:{networkName:'private',subnetCidr:'192.168.10.0/24',quotaProfileId:'basic',projectName:'existing-production-project'}});
      assert.equal(request.status,202);projectId=request.data.projectRequest.id;projectName=request.data.projectRequest.projectName;
      assert.match(projectName,/^community-user-/);assert.notEqual(projectName,'existing-production-project');
      const results=await Promise.all([admin(`/api/admin/projects/${projectId}/review`,{method:'POST',body:{action:'approve'}}),admin(`/api/admin/projects/${projectId}/review`,{method:'POST',body:{action:'approve'}})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      assert.equal(cloud.data.size,1);assert.equal((await db.user(userId)).selfServiceVmEnabled,true);
    });
    await t.test('VM creation waits for approval and stores encrypted credentials',async()=>{
      await admin('/api/admin/settings',{method:'PATCH',body:{selfServiceVmAllowedImages:['ubuntu'],selfServiceVmAllowedFlavors:['small']}});
      const requested=await user('/api/cloud-console/instances',{method:'POST',body:{projectName,name:'my-vm',imageRef:'ubuntu',flavorRef:'small',networkId:'net-private',securityGroupNames:['default'],bootSource:'image',bootVolumeSizeGb:20}});
      assert.equal(requested.status,202);assert.equal(cloud.data.get(projectName).instances.length,0);
      const actionId=requested.data.action.id;
      assert.equal((await admin(`/api/admin/cloud-console/actions/${actionId}/review`,{method:'POST',body:{action:'approve'}})).status,200);
      assert.equal((await admin(`/api/admin/cloud-console/actions/${actionId}/review`,{method:'POST',body:{action:'approve'}})).status,409);
      const stored=await db.action(actionId);assert.equal(stored.result.accessCredentials,undefined);assert.ok(stored.result.accessCredentialsEncrypted);
      const own=await user('/api/cloud-console/actions');assert.equal(own.data.actions[0].result.accessCredentials.username,'cloud');serverId=own.data.actions[0].result.id;
      const adminView=await admin('/api/cloud-console/actions');assert.equal(adminView.data.actions[0].result.accessCredentials,undefined);assert.equal(adminView.data.actions[0].result.accessCredentialsEncrypted,undefined);
    });
    await t.test('foreign projects, foreign VM owners and disabled floating IP are rejected',async()=>{
      assert.equal((await user('/api/cloud-console/snapshot?projectName=unrelated')).status,403);
      cloud.data.get(projectName).instances.push({id:'foreign-vm',metadata:{terminal_lab_managed:'true',terminal_lab_user_id:'999'}});
      assert.equal((await user('/api/cloud-console/instances/foreign-vm',{method:'DELETE',body:{projectName}})).status,403);
      assert.equal((await user('/api/cloud-console/floating-ips',{method:'POST',body:{projectName,floatingNetworkId:'net-external'}})).status,403);
    });
    await t.test('VM deletion works through the approval pipeline',async()=>{
      const requested=await user(`/api/cloud-console/instances/${serverId}`,{method:'DELETE',body:{projectName}});assert.equal(requested.status,202);
      assert.equal((await admin(`/api/admin/cloud-console/actions/${requested.data.action.id}/review`,{method:'POST',body:{action:'approve'}})).status,200);
      assert.equal(cloud.data.get(projectName).instances.some(s=>s.id===serverId),false);
    });
    await t.test('project deletion is blocked while a cloud action is executing',async()=>{
      const action=await db.createAction(userId,projectName,'POST /api/cloud-console/networks',{body:{name:'running'},params:{}},'executing');
      const response=await user('/api/cloud-console/project',{method:'DELETE',body:{projectName,confirmProjectName:projectName}});
      assert.equal(response.status,409);assert.equal((await db.project(projectId)).status,'approved');await db.updateAction(action.id,'failed',{},'test completed');
    });
    await t.test('education endpoints are absent and last active admin is protected',async()=>{
      assert.equal((await user('/api/courses')).status,404);assert.equal((await admin('/api/admin/labs')).status,404);
      const id=(await db.userByName('admin')).id;assert.equal((await admin(`/api/admin/users/${id}`,{method:'PATCH',body:{role:'user'}})).status,409);
    });
    await t.test('disabling an account invalidates its active sessions',async()=>{
      const queued=await user('/api/cloud-console/networks',{method:'POST',body:{projectName,name:'must-not-execute'}});assert.equal(queued.status,202);
      assert.equal((await admin(`/api/admin/users/${userId}`,{method:'PATCH',body:{status:'disabled'}})).status,200);
      assert.equal((await user('/api/cloud-console/project')).status,401);
      assert.equal((await admin(`/api/admin/cloud-console/actions/${queued.data.action.id}/review`,{method:'POST',body:{action:'approve'}})).status,403);
      assert.equal(cloud.data.get(projectName).networks.some(n=>n.name==='must-not-execute'),false);
    });
    await t.test('a legacy database cannot be initialized as a community database',async()=>{
      await db.query('DROP TABLE community_migrations');
      await assert.rejects(db.migrate({username:'admin',password:'test-password-2026'}),/non-community database/);
      assert.equal((await db.users()).length,2);
      await db.query('CREATE TABLE community_migrations (version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now())');
    });
    await t.test('project deletion and pending action approval cannot both acquire execution rights',async()=>{
      const owner=await db.userByName('admin');
      const project=await db.createProject(owner.id,'community-race-project',{networkName:'private',subnetCidr:'192.168.20.0/24'});await db.updateProject(project.id,'approved',{});
      const action=await db.createAction(owner.id,project.projectName,'POST /api/cloud-console/networks',{body:{name:'race'},params:{}},'requested');
      const [approval,deletion]=await Promise.all([db.claimAction(action.id,owner.id),db.claimProjectDeletion(project.id,owner.id)]);
      assert.notEqual(Boolean(approval),Boolean(deletion));
    });
  }finally{
    if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await db.close();
  }
});

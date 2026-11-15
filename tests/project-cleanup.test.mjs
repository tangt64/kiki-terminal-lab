import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCleanupPlan,projectCleanupRequest} from '../platform/shared/project-cleanup.js';

const user={role:'student',adminPermissions:['admin:access','admin:cloud']};
const project={projectName:'example-project',ok:true};
const requests=[{id:1,status:'approved',projectName:'example-project'},{id:2,status:'approved',projectName:'EXAMPLE-PROJECT'},{id:3,status:'approved',projectName:'another-project'},{id:4,status:'requested',projectName:'example-project'},{id:1,status:'approved',projectName:'example-project'}];
const plan=extra=>projectCleanupPlan({user,project,requests,...extra});

test('project action includes every approved link of exactly one project without mutating input',()=>{
  const before=JSON.stringify(requests);const p=plan();
  assert.equal(p.allowed,true);assert.deepEqual(p.requestIds,[1,2]);assert.equal(JSON.stringify(requests),before);
  assert.equal(p.confirmation,'DELETE example-project');
});
test('console access and unrelated delegated permissions do not grant cleanup authority',()=>{
  for(const actor of [null,{role:'student'},{role:'student',adminPermissions:['admin:access']},{role:'student',adminPermissions:['admin:users']}])assert.equal(plan({user:actor}).allowed,false);
  assert.equal(plan({user:{role:'administrator'}}).allowed,true);
});
test('failed, pending, missing and unapproved snapshots cannot start project cleanup',()=>{
  for(const snapshot of [undefined,{...project,ok:false},{...project,pending:true},{...project,projectName:''}])assert.equal(plan({project:snapshot}).allowed,false);
  assert.equal(plan({requests:[]}).allowed,false);assert.equal(plan({busy:true}).allowed,false);
  assert.equal(plan({requests:[{id:0,status:'approved',projectName:project.projectName}]}).allowed,false);
});
test('configured service and PoC projects remain protected case-insensitively',()=>{
  for(const key of ['serviceProjectName','pocProjectName'])assert.equal(plan({platformStatus:{[key]:' EXAMPLE-PROJECT '}}).allowed,false);
});
test('wrong or incomplete typed confirmation never produces a cleanup request',()=>{
  for(const phrase of ['', 'DELETE', 'DELETE another-project','delete example-project'])assert.throws(()=>projectCleanupRequest(plan(),phrase));
  assert.throws(()=>projectCleanupRequest(plan({busy:true}),'DELETE example-project'));
});
test('explicit confirmation uses the existing guarded community API payload without force escalation',()=>{
  const p=plan(),body=projectCleanupRequest(p,' DELETE example-project ');
  assert.deepEqual(body,{ids:[1,2],cleanupOpenstackProjects:true,confirmOpenstackProjectCleanup:'DELETE_OPENSTACK_PROJECTS'});
  body.ids.push(99);assert.deepEqual(p.requestIds,[1,2]);assert.equal('force' in body,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomBytes} from 'node:crypto';

// Exercise the actual portal handler without mounting the unrelated portal state.
const source=fs.readFileSync(new URL('../platform/client/src/portal-state.js',import.meta.url),'utf8');
const start=source.indexOf('  async function onResetPassword(user) {');
const end=source.indexOf('  async function onIssueResetPin(user) {',start);
assert.ok(start>=0&&end>start);
function handler({prompt,api,setAdminStatus}){
  return vm.runInNewContext('('+source.slice(start,end).trim()+')',{window:{prompt},api,setAdminStatus});
}
test('admin reset starts empty and cancelling or submitting empty text sends no request',async()=>{
  for(const reply of [null,'']){
    let prompted=false;
    const reset=handler({prompt:(message,initial)=>{prompted=true;assert.equal(initial,'');return reply;},api:()=>assert.fail('reset must not be submitted'),setAdminStatus:()=>assert.fail('cancel must not change status')});
    await reset({id:7,username:'fixture-user'});assert.equal(prompted,true);
  }
});
test('admin reset sends the chosen password once and never echoes it in the status',async()=>{
  const chosen=randomBytes(24).toString('base64url');const requests=[],statuses=[];
  const reset=handler({prompt:()=>chosen,api:async(url,options)=>{requests.push({url,method:options.method,password:options.body.password});},setAdminStatus:message=>statuses.push(message)});
  await reset({id:7,username:'fixture-user'});
  assert.deepEqual(requests,[{url:'/api/admin/users/7/reset-password',method:'POST',password:chosen}]);
  assert.equal(statuses.length,1);assert.match(statuses[0],/초기화/);assert.ok(!statuses[0].includes(chosen));
});
test('admin reset keeps server error feedback',async()=>{
  const statuses=[];
  const reset=handler({prompt:()=>randomBytes(24).toString('base64url'),api:async()=>{throw new Error('fixture rejected');},setAdminStatus:message=>statuses.push(message)});
  await reset({id:7,username:'fixture-user'});assert.deepEqual(statuses,['fixture rejected']);
});

import test from'node:test';import assert from'node:assert/strict';
import{runCloudBulkActions}from'../platform/client/src/cloud-bulk-actions.js';
test('start requests are strictly sequential and preserve per-VM failures',async()=>{
 let active=0,max=0;const calls=[];
 const result=await runCloudBulkActions({instances:['a','b','c'].map(id=>({id,status:'SHUTOFF'})),operation:'start',runAction:async r=>{active++;max=Math.max(max,active);calls.push(r);await new Promise(resolve=>setTimeout(resolve,5));active--;if(calls.length===2)throw Error('denied');return {approvalRequired:calls.length===3}}});
 assert.equal(max,1);assert.deepEqual(result.map(r=>r.status),['success','failed','pending']);assert.ok(calls.every(r=>r.method==='POST'&&r.body.action==='start'));
});
test('mixed states and duplicate VM selections send no request',async()=>{
 for(const instances of [[{id:'a',status:'ACTIVE'}],[{id:'a',status:'SHUTOFF'},{id:'a',status:'SHUTOFF'}],[]])await assert.rejects(runCloudBulkActions({instances,operation:'start',runAction:()=>assert.fail('unexpected VM mutation')}));
});


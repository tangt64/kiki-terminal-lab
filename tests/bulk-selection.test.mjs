import test from'node:test';import assert from'node:assert/strict';
import{selectBulkStartTargets}from'../platform/client/src/cloud-bulk-actions.js';
test('mixed selection starts stopped idle rows only and deduplicates targets',()=>{
 const rows=[{id:'active',status:'ACTIVE'},{id:'ready',status:'SHUTOFF'},{id:'task',status:'SHUTOFF','OS-EXT-STS:task_state':'powering-on'},{id:'busy',status:'SHUTOFF'},{id:'ready',status:'SHUTOFF'}];
 assert.deepEqual(selectBulkStartTargets(rows,id=>id==='busy').map(v=>v.id),['ready']);
});


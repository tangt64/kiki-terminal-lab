import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMUNITY_ADMIN_GROUPS,COMMUNITY_SERVICES,filterCommunityInstances,communityVmSelection} from '../platform/client/src/community-workspace.js';
import {isEducationAdminTab} from '../platform/shared/community-profile.js';
const instances=[{id:'a',name:'node-2',status:'SHUTOFF'},{id:'b',name:'node-1',status:'ACTIVE'},{id:'c',name:'worker',status:'SHUTOFF','OS-EXT-STS:task_state':'powering-on'}];
test('community menu preserves general services without adding education destinations',()=>{
  assert.equal(COMMUNITY_ADMIN_GROUPS.length,6);
  const tabs=COMMUNITY_ADMIN_GROUPS.flatMap(g=>g.tabs);assert.equal(new Set(tabs).size,tabs.length);
  for(const tab of tabs)assert.equal(isEducationAdminTab(tab),false,tab);
  for(const key of ['zun','magnum','trove','aiGpu','llm','cicd','internalImageServer'])assert(COMMUNITY_SERVICES.some(([entry])=>entry===key));
});
test('VM filters do not mutate snapshots or discard the separate selection',()=>{
  const before=JSON.stringify(instances),ids=['a','b','missing'];
  assert.deepEqual(filterCommunityInstances(instances,{status:'ACTIVE'}).map(vm=>vm.id),['b']);
  const filtered=filterCommunityInstances(instances,{query:'node-1'});
  const summary=communityVmSelection(instances,ids,filtered);
  assert.deepEqual(summary,{targets:[instances[0]],selectedCount:3,eligibleCount:1,hiddenCount:1,excludedCount:2});
  assert.equal(JSON.stringify(instances),before);assert.deepEqual(ids,['a','b','missing']);
});
test('pending VM transitions and duplicate entries remain ineligible or deduplicated by existing policy',()=>{
  assert.deepEqual(communityVmSelection([...instances,instances[0]],['a','c']).targets,[instances[0]]);
  assert.deepEqual(communityVmSelection([],['a']).targets,[]);
});

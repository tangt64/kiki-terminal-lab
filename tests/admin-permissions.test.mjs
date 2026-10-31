import test from 'node:test';
import assert from 'node:assert/strict';
import {canManageAccount,hasAdminPermission,requiredAdminPermission} from '../platform/shared/admin-permissions.js';

const reader={role:'student',adminPermissions:['admin:access']};
const manager={...reader,adminPermissions:['admin:access','admin:users']};
const member={role:'student',adminPermissions:[]};
test('console access is not user mutation or secret/backup authority',()=>{
  assert.equal(hasAdminPermission(reader,requiredAdminPermission('GET','/api/admin/users')),true);
  for(const [method,path]of [['PATCH','/api/admin/users/:id/access'],['POST','/api/admin/users'],['POST','/api/admin/users/batch-create'],['POST','/api/admin/users/bulk-approve'],['GET','/api/admin/backups/export'],['POST','/api/admin/backups/restore'],['GET','/api/admin/platform-status'],['POST','/api/admin/new-unknown-operation']])assert.equal(hasAdminPermission(reader,requiredAdminPermission(method,path)),false,path);
  const ops={...reader,adminPermissions:['admin:access','admin:ops']};
  assert.equal(hasAdminPermission(ops,requiredAdminPermission('GET','/api/admin/backups/export')),false);
  assert.equal(hasAdminPermission(ops,requiredAdminPermission('POST','/api/admin/backups/restore')),false);
});
test('delegated account manager preserves ordinary workflows and cannot cross privileged accounts',()=>{
  assert.equal(canManageAccount(manager,member,{role:'student',status:'approved'}),true);
  assert.equal(canManageAccount(manager,null,{role:'student'}),true);
  for(const role of ['admin','administrator',' ADMIN ','관리자'])assert.equal(canManageAccount(manager,member,{role}),false,role);
  for(const target of [{role:'admin'},{role:'administrator'},{role:'student',adminPermissions:['admin:all']},{role:'student',adminPermissions:['admin:access']},{role:'student',admin_permissions_json:'["admin:platform"]'}])assert.equal(canManageAccount(manager,target),false);
  for(const value of [[],['admin:all'],'["admin:all"]'])assert.equal(canManageAccount(manager,member,{adminPermissions:value}),false);
  assert.equal(canManageAccount(reader,member),false);
});
test('full administrator aliases and explicit all delegation retain management authority',()=>{
  for(const actor of [{role:'admin'},{role:'administrator'},{role:'관리자'},{role:'student',adminPermissions:['admin:all']}]){
    assert.equal(canManageAccount(actor,{role:'admin'},{role:'admin',adminPermissions:['admin:all']}),true);
    assert.equal(hasAdminPermission(actor,requiredAdminPermission('POST','/api/admin/backups/restore')),true);
  }
});

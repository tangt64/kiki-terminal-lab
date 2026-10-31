import assert from 'node:assert/strict';
import test from 'node:test';
import { createVault } from '../server/secrets.js';
import { validateOperation } from '../server/cloud.js';
import { DEFAULT_SETTINGS } from '../server/config.js';
import { quotaForRequest,validatedSettings } from '../server/policy.js';
import { consoleWebSocketUrl } from '../server/terminals.js';

test('VM credentials are authenticated and fail closed after ciphertext tampering',()=>{
  const vault=createVault('ab'.repeat(32));const credentials={username:'cloud',password:'confidential'};
  const sealed=vault.encrypt(credentials);assert.ok(!sealed.includes(credentials.password));assert.deepEqual(vault.decrypt(sealed),credentials);
  const bytes=Buffer.from(sealed,'base64');bytes[30]^=1;assert.throws(()=>vault.decrypt(bytes.toString('base64')));
});
test('project quota cannot exceed administrator limits or accept non-finite values',()=>{
  assert.throws(()=>quotaForRequest({quotaProfileId:'custom',requestedQuota:{instances:1,cores:1,ram:Infinity,volumes:1,gigabytes:1}},DEFAULT_SETTINGS));
  assert.throws(()=>quotaForRequest({quotaProfileId:'custom',requestedQuota:{instances:1000,cores:1000,ram:1024,volumes:1,gigabytes:1}},DEFAULT_SETTINGS));
  assert.equal(quotaForRequest({quotaProfileId:'basic'},DEFAULT_SETTINGS).quota.instances,2);
});
test('cloud mutations cannot target another owner or an external network',()=>{
  const snapshot={instances:[{id:'server-other',metadata:{terminal_lab_user_id:'99',terminal_lab_managed:'true'}}],networks:[{id:'network-external','router:external':true}]};
  const context={snapshot,user:{id:2,role:'user'},settings:DEFAULT_SETTINGS,body:{}};
  assert.throws(()=>validateOperation('deleteInstance',{...context,params:{id:'server-other'}}),{statusCode:403});
  assert.throws(()=>validateOperation('deleteNetwork',{...context,params:{id:'network-external'}}),{statusCode:400});
});
test('protected groups and foreign attachment IDs cannot be modified',()=>{
  const snapshot={securityGroups:[{id:'group-default',name:'default',security_group_rules:[{id:'rule-1'}]}],volumes:[{id:'volume-1',attachments:[{attachment_id:'attachment-owner',server_id:'server-owner'}]}],instances:[{id:'server-owner',metadata:{terminal_lab_user_id:'2',terminal_lab_managed:'true'}}]};
  const context={snapshot,user:{id:2,role:'user'},settings:DEFAULT_SETTINGS};
  assert.throws(()=>validateOperation('deleteRule',{...context,params:{id:'rule-1'}}),{statusCode:403});
  assert.throws(()=>validateOperation('detachVolume',{...context,params:{id:'volume-1'},body:{serverId:'server-owner',attachmentId:'foreign-attachment'}}),{statusCode:403});
});
test('settings updates cannot enable unimplemented flags or alter arbitrary server values',()=>{
  const value=validatedSettings({databaseUrl:'attacker',publicDomainsEnabled:true,selfServiceVmAllowedImages:['image-1']},DEFAULT_SETTINGS);
  assert.equal(value.publicDomainsEnabled,false);assert.equal(value.databaseUrl,undefined);assert.deepEqual(value.selfServiceVmAllowedImages,['image-1']);
});
test('Nova noVNC HTML URLs become same-host websocket URLs and retain tokens',()=>{
  assert.equal(consoleWebSocketUrl('https://vnc.example.com/vnc_lite.html?path=%3Ftoken%3Dabc'),'wss://vnc.example.com/?token=abc');
  assert.equal(consoleWebSocketUrl('https://vnc.example.com/vnc_auto.html?token=abc'),'wss://vnc.example.com/websockify?token=abc');
  assert.throws(()=>consoleWebSocketUrl('file:///etc/passwd'));
});

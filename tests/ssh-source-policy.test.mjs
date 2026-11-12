import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAllDocuments} from 'yaml';
import {sshSourceCidrs} from '../platform/server/ssh-source-policy.js';
import {ensureValidationSecurityGroup} from '../platform/server/kiki-cloud-openstack.js';
import {buildCapoManifest} from '../platform/server/magnum.js';

test('SSH access requires explicit valid operator CIDRs',async t=>{
  const previousNetwork=Object.fromEntries(['CAPO_POD_CIDR','CAPO_SERVICE_CIDR'].map(k=>[k,process.env[k]]));
  t.after(()=>{for(const[k,v]of Object.entries(previousNetwork)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  process.env.CAPO_POD_CIDR='192.0.2.0/24';process.env.CAPO_SERVICE_CIDR='198.51.100.0/24';
  assert.deepEqual(sshSourceCidrs(''),[]);
  for(const value of ['not-a-network','192.0.2.1','192.0.2.1/33','2001:db8::1/129','192.0.2.1/32/extra','192.0.2.1/-1'])assert.throws(()=>sshSourceCidrs(value),/valid IPv4\/IPv6 CIDRs/);
  const prior=process.env.COMMUNITY_SSH_SOURCE_CIDRS;
  try{
    delete process.env.COMMUNITY_SSH_SOURCE_CIDRS;
    await assert.rejects(ensureValidationSecurityGroup(()=>{throw Error('Must not call OpenStack without configuration');},'demo'),/Set COMMUNITY_SSH_SOURCE_CIDRS/);
    const requests=[];
    process.env.COMMUNITY_SSH_SOURCE_CIDRS='192.0.2.10/32,2001:db8::10/128,192.0.2.10/32';
    await ensureValidationSecurityGroup(async(service,path,options)=>{assert.equal(service,'network');if(!options)return {security_groups:[{id:'demo-sg',name:'demo',security_group_rules:[]}]};requests.push(options.body.security_group_rule);return {};},'demo');
    assert.deepEqual(requests.map(r=>[r.remote_ip_prefix,r.ethertype]),[['192.0.2.10/32','IPv4'],['2001:db8::10/128','IPv6']]);
    const profile={id:'demo',name:'demo',imageId:'demo-image',flavorId:'tiny',masterFlavorId:'tiny'};
    const render=()=>buildCapoManifest({clusterUuid:'demo-cluster',projectName:'demo-project',name:'demo',profile,nodeCount:1,masterCount:1});
    const cluster=manifest=>parseAllDocuments(manifest).map(d=>d.toJSON()).find(d=>d.kind==='OpenStackCluster');
    assert.deepEqual(cluster(await render()).spec.managedSecurityGroups.allNodesSecurityGroupRules.map(r=>r.remoteIPPrefix),['192.0.2.10/32','2001:db8::10/128']);
    delete process.env.COMMUNITY_SSH_SOURCE_CIDRS;
    assert.equal(cluster(await render()).spec.managedSecurityGroups.allNodesSecurityGroupRules,undefined);
  }finally{if(prior===undefined)delete process.env.COMMUNITY_SSH_SOURCE_CIDRS;else process.env.COMMUNITY_SSH_SOURCE_CIDRS=prior;}
});

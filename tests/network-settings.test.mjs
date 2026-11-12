import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildCapoManifest} from '../platform/server/magnum.js';
import {resolveMetalLbVipPoolConfig,buildMetalLbVipAllocation} from '../platform/server/metallb-vip.js';

test('MetalLB requires a chosen pool and preserves explicitly supplied or saved allocations',()=>{
 assert.throws(()=>resolveMetalLbVipPoolConfig(),/METALLB_VIP_POOL_CIDR/);
 const chosen=resolveMetalLbVipPoolConfig({poolCidr:'192.0.2.0/24',blockPrefix:28});
 assert.equal(chosen.blockCount,16);
 assert.equal(buildMetalLbVipAllocation('192.0.2.16/28').cidr,'192.0.2.16/28');
});

test('CAPO requires both chosen ranges and renders them without falling back to a deployment network',async t=>{
 const before={pod:process.env.CAPO_POD_CIDR,service:process.env.CAPO_SERVICE_CIDR};
 t.after(()=>{for(const [name,value]of [['CAPO_POD_CIDR',before.pod],['CAPO_SERVICE_CIDR',before.service]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
 const dir=await mkdtemp(path.join(tmpdir(),'community-capo-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'cluster.yaml');await writeFile(file,'pods: {{podCidr}}\nservices: {{serviceCidr}}\n');
 const options={clusterUuid:'synthetic-cluster',projectName:'synthetic-project',name:'synthetic',profile:{templatePath:file},masterCount:1,nodeCount:1};
 delete process.env.CAPO_POD_CIDR;delete process.env.CAPO_SERVICE_CIDR;
 await assert.rejects(buildCapoManifest(options),/CAPO_POD_CIDR and CAPO_SERVICE_CIDR/);
 process.env.CAPO_POD_CIDR='192.0.2.0/24';
 await assert.rejects(buildCapoManifest(options),/CAPO_POD_CIDR and CAPO_SERVICE_CIDR/);
 process.env.CAPO_SERVICE_CIDR='198.51.100.0/24';
 const manifest=await buildCapoManifest(options);assert.match(manifest,/pods: 192\.0\.2\.0\/24/);assert.match(manifest,/services: 198\.51\.100\.0\/24/);
});

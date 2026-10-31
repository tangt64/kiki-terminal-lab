import path from 'node:path';
import {getKikiCloudContext,kikiOpenstackFetch} from './heat.js';
import {getOpenstackRequestCaBundle} from './openstack-fetch.js';
import {sshSourceCidrs} from './ssh-source-policy.js';
import {receiveIso,streamIsoToGlance} from './iso-upload.js';

export async function projectApi(projectName){
 const context=await getKikiCloudContext(projectName);
 const api=(kind,suffix,options={})=>{
  let endpoint=context[kind+'Endpoint'];
  if(!endpoint)throw Error('OpenStack '+kind+' endpoint unavailable');
  if(kind==='image')endpoint=endpoint.replace(/\/v2\/?$/,'');
  if(kind==='network'&&!/\/v2\.0$/.test(endpoint))endpoint+='/v2.0';
  return kikiOpenstackFetch(endpoint+suffix,{...options,token:context.token});
 };
 return {context,api};
}

export async function importIso({api,context},manifest,parts,directory,owner){
 const existing=(await api('image','/v2/images?disk_format=iso&limit=500')).images.find(i=>i.status==='active'&&i.owner===context.projectId&&i.terminal_lab_user_id===String(owner)&&i.terminal_lab_iso_sha256===manifest.iso_sha256);
 if(existing)return existing;
 const file=await receiveIso(parts,{directory:path.join(directory,'uploads'),expectedSha256:manifest.iso_sha256});
 try{
  if(file.size!==manifest.iso_bytes)throw Error('ISO length mismatch');
  const image=await api('image','/v2/images',{method:'POST',body:{name:'kiki-build-'+manifest.job_id,disk_format:'iso',container_format:'bare',visibility:'private',hw_firmware_type:'uefi',hw_disk_bus:'scsi',hw_cdrom_bus:'scsi',hw_scsi_model:'virtio-scsi',os_secure_boot:'disabled',terminal_lab_managed:'true',terminal_lab_user_id:String(owner),terminal_lab_iso_sha256:manifest.iso_sha256}});
  await streamIsoToGlance(context.imageEndpoint.replace(/\/v2\/?$/,'')+'/v2/images/'+image.id+'/file',{...file,token:context.token,ca:getOpenstackRequestCaBundle()});
  return await api('image','/v2/images/'+image.id);
 }finally{await file.cleanup();}
}

export async function ensureValidationSecurityGroup(api,name){
 const sources=sshSourceCidrs();
 if(!sources.length)throw Error('Set COMMUNITY_SSH_SOURCE_CIDRS before enabling validation SSH access');
 const listed=await api('network','/security-groups');
 let group=listed.security_groups.find(g=>g.name===name);
 if(!group)group=(await api('network','/security-groups',{method:'POST',body:{security_group:{name,description:'KIKI ISO validation: SSH from Terminal Lab only'}}})).security_group;
 const rules=sources.map(cidr=>({direction:'ingress',ethertype:cidr.includes(':')?'IPv6':'IPv4',protocol:'tcp',port_range_min:22,port_range_max:22,remote_ip_prefix:cidr}));
 for(const rule of rules){
  if(!group.security_group_rules.some(r=>Object.entries(rule).every(([k,v])=>r[k]===v))){
   try{await api('network','/security-group-rules',{method:'POST',body:{security_group_rule:{...rule,security_group_id:group.id}}});}
   catch(e){if(e.statusCode!==409&&!String(e.message).includes('already exists'))throw e;}
  }
 }
 return group;
}

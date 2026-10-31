export function problem(statusCode,message){return Object.assign(new Error(message),{statusCode});}
export function text(value,label,max=128){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw problem(400,`${label} 값을 확인하세요.`);return value.trim();}
export function identifier(value){const id=text(value,'자원 ID',128);if(!/^[a-zA-Z0-9_.:-]+$/.test(id))throw problem(400,'자원 ID 형식이 잘못되었습니다.');return id;}
export function integer(value,label,min=1,max=65535){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw problem(400,`${label}: ${min}~${max} 정수를 입력하세요.`);return n;}
export function cidr(value){const input=text(value,'IPv4 CIDR',18);const match=input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);if(!match||match.slice(1,5).some(n=>Number(n)>255)||Number(match[5])>32)throw problem(400,'IPv4 CIDR을 확인하세요.');return input;}
export function quotaForRequest(body,settings){
  const profiles=settings.selfServiceVmProjectQuotaProfiles;
  const profile=profiles.find(p=>p.id===body.quotaProfileId);
  if(!profile&&body.quotaProfileId!=='custom')throw problem(400,'쿼터 프로필을 선택하세요.');
  const max=profiles.find(p=>p.id==='performance')?.quota||profiles.at(-1).quota;
  const values=profile?.quota||body.requestedQuota||{};
  const quota=Object.fromEntries(['instances','cores','ram','volumes','gigabytes'].map(key=>[key,integer(values[key],key,1,max[key])]));
  if(quota.cores<quota.instances)throw problem(400,'vCPU 수는 VM 수 이상이어야 합니다.');
  return {quota,quotaProfileId:body.quotaProfileId};
}
export function validatedSettings(input,current){
  const value={...current};
  for(const key of ['selfServiceVmAutoProvisionEnabled','selfServiceVmProjectAutoApproveEnabled','selfServiceVmFloatingIpEnabled']){
    if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw problem(400,'잘못된 설정 값');value[key]=input[key];}
  }
  for(const key of ['selfServiceVmAllowedImages','selfServiceVmAllowedFlavors']){
    if(input[key]!==undefined){if(!Array.isArray(input[key])||input[key].length>100)throw problem(400,'허용 목록이 잘못되었습니다.');value[key]=[...new Set(input[key].map(item=>text(item,'허용 목록',128)))];}
  }
  if(input.selfServiceVmProjectExternalNetworkName!==undefined)value.selfServiceVmProjectExternalNetworkName=input.selfServiceVmProjectExternalNetworkName?text(input.selfServiceVmProjectExternalNetworkName,'외부 네트워크'):'';
  if(input.selfServiceVmProjectQuotaProfiles!==undefined){
    if(!Array.isArray(input.selfServiceVmProjectQuotaProfiles)||input.selfServiceVmProjectQuotaProfiles.length!==3)throw problem(400,'기본형·표준형·고성능형 쿼터가 필요합니다.');
    value.selfServiceVmProjectQuotaProfiles=['basic','standard','performance'].map(id=>{
      const p=input.selfServiceVmProjectQuotaProfiles.find(x=>x.id===id);if(!p)throw problem(400,'쿼터 프로필이 누락되었습니다.');
      const limits={instances:100,cores:1000,ram:4194304,volumes:1000,gigabytes:100000};
      const quota=Object.fromEntries(Object.keys(limits).map(key=>[key,integer(p.quota?.[key],key,1,limits[key])]));
      if(quota.cores<quota.instances)throw problem(400,'vCPU 수는 VM 수 이상이어야 합니다.');
      return {id,label:text(p.label,'프로필 이름',30),quota};
    });
    for(const p of value.selfServiceVmProjectQuotaProfiles)for(const key of Object.keys(p.quota))if(p.quota[key]>value.selfServiceVmProjectQuotaProfiles[2].quota[key])throw problem(400,'고성능형 쿼터가 각 프로필의 최댓값이어야 합니다.');
  }
  return value;
}

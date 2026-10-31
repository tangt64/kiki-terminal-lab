import { randomBytes } from 'node:crypto';
import { problem,identifier,integer,text,cidr } from './policy.js';

// Only infrastructure functions are loaded. No original portal server, DB or environment is imported.
export async function createOpenstackCloud(){
  const infra=await import('./infrastructure/heat.js');
  return {
    async snapshot(projectName){
      const snapshot=await infra.getOpenstackProjectSnapshot({projectName});
      snapshot.flavors=await infra.listFlavorDetails({projectName});
      snapshot.dnsAvailable=false;
      return snapshot;
    },
    provision(project){return infra.ensureSelfServiceOpenstackProject({projectName:project.projectName,ownerLabel:`Community user ${project.userId}`,quota:project.config.quota,ensureNetwork:true,networkName:project.config.networkName,subnetName:`${project.config.networkName}-subnet`,subnetCidr:project.config.subnetCidr,routerName:`${project.projectName}-router`,externalNetworkName:project.config.externalNetworkName,securityGroupName:'terminal-lab.kr'});},
    deleteProject(project){return infra.cleanupSelfServiceOpenstackProject({projectName:project.projectName});},
    execute(operation,args){return executeInfrastructure(infra,operation,args);},
    console(projectName,serverId){return infra.createOpenstackRemoteConsole({projectName,serverId,protocol:'vnc',type:'novnc'});},
    uploadIso(options){return infra.uploadOpenstackIso(options);},
  };
}

// Route declarations double as the operation allowlist used for approval replay.
export const OPERATIONS=[
  ['POST','/instances/:id/external-ssh','createSshForward'],['DELETE','/instances/:id/external-ssh','deleteSshForward'],
  ['POST','/instances/:id/domains','createPublicRoute'],['DELETE','/instances/:id/domains/:subdomain','deletePublicRoute'],
  ['POST','/instances/:id/tcp-forwards','createTcpForward'],['DELETE','/instances/:id/tcp-forwards/:externalPort','deleteTcpForward'],
  ['POST','/instances','createInstance'],['DELETE','/instances/:id','deleteInstance'],['POST','/instances/:id/action','instanceAction'],
  ['POST','/instances/:id/complete-iso-install','completeIso'],
  ['POST','/instances/:id/networks','attachNetwork'],['DELETE','/instances/:id/networks/:portId','detachNetwork'],
  ['POST','/instances/:id/security-groups','attachGroup'],['DELETE','/instances/:id/security-groups/:name','detachGroup'],
  ['POST','/volumes','createVolume'],['DELETE','/volumes/:id','deleteVolume'],['POST','/volumes/:id/attach','attachVolume'],['POST','/volumes/:id/detach','detachVolume'],
  ['POST','/networks','createNetwork'],['DELETE','/networks/:id','deleteNetwork'],['POST','/subnets','createSubnet'],['DELETE','/subnets/:id','deleteSubnet'],
  ['POST','/routers','createRouter'],['DELETE','/routers/:id','deleteRouter'],['POST','/routers/:id/interfaces','connectSubnet'],['DELETE','/routers/:id/interfaces/:subnetId','disconnectSubnet'],
  ['POST','/floating-ips','allocateFloatingIp'],['DELETE','/floating-ips/:id','releaseFloatingIp'],['POST','/floating-ips/:id/association','associateFloatingIp'],
  ['POST','/security-groups','createGroup'],['DELETE','/security-groups/:id','deleteGroup'],['POST','/security-groups/:id/rules','createRule'],['DELETE','/security-group-rules/:id','deleteRule'],
  ['POST','/load-balancers','createLoadBalancer'],['DELETE','/load-balancers/:id','deleteLoadBalancer'],
  ['POST','/load-balancer-listeners','createListener'],['DELETE','/load-balancer-listeners/:id','deleteListener'],
  ['POST','/load-balancer-pools','createPool'],['DELETE','/load-balancer-pools/:id','deletePool'],
  ['POST','/load-balancer-pools/:id/members','createMember'],['DELETE','/load-balancer-pools/:id/members/:memberId','deleteMember'],
  ['POST','/load-balancer-health-monitors','createMonitor'],['DELETE','/load-balancer-health-monitors/:id','deleteMonitor'],
  ['POST','/alarms','createAlarm'],['DELETE','/alarms/:id','deleteAlarm'],
  ['POST','/reservations','createReservation'],['DELETE','/reservations/:id','deleteReservation'],
  ['POST','/shares','createShare'],['DELETE','/shares/:id','deleteShare'],
];
export const operationLabel=(method,path)=>`${method} /api/cloud-console${path}`;

export function requireResource(snapshot,collection,id){
  identifier(id);
  const row=(snapshot[collection]||[]).find(row=>row.id===id);
  if(!row)throw problem(404,'현재 프로젝트에서 해당 자원을 찾지 못했습니다.');
  return row;
}
export function requireOwnedInstance(snapshot,id,user){
  const row=requireResource(snapshot,'instances',id);
  if(user.role!=='admin'&&(row.metadata?.terminal_lab_managed!=='true'||String(row.metadata?.terminal_lab_user_id)!==String(user.id)))throw problem(403,'본인이 생성한 인스턴스만 조작할 수 있습니다.');
  return row;
}

export function validateOperation(kind,{body={},params={},snapshot,user,settings}){
  // Persist only bounded JSON primitives; never accept client-supplied endpoints, commands or credentials.
  if(JSON.stringify(body).length>8192)throw problem(400,'작업 입력이 너무 큽니다.');
  const allowedFields=new Set(['name','description','imageRef','flavorRef','networkId','securityGroupNames','bootSource','bootVolumeSizeGb','action','securityGroupName','sizeGb','serverId','attachmentId','cidr','externalNetworkId','subnetId','floatingNetworkId','portId','direction','protocol','portMin','portMax','remoteIpPrefix','vipSubnetId','loadBalancerId','protocolPort','listenerId','algorithm','poolId','address','type','delay','timeout','maxRetries','urlPath','expectedCodes','resourceId','metric','threshold','comparisonOperator','period','startDate','endDate','resourceType','amount','flavor','shareType','shareProtocol','installationConfirmed','mode','targetPort','port','subdomain']);
  const b=Object.fromEntries(Object.entries(body).filter(([key])=>allowedFields.has(key)));
  for(const v of Object.values(params))identifier(v);
  const own=id=>requireOwnedInstance(snapshot,id,user);
  const resource=(collection,id)=>requireResource(snapshot,collection,id);
  const network=id=>{const n=resource('networks',id);if(n['router:external'])throw problem(400,'외부 네트워크에는 이 작업을 수행할 수 없습니다.');return n;};
  const group=id=>{const g=resource('securityGroups',id);if(['default','terminal-lab.kr'].includes(g.name?.toLowerCase()))throw problem(403,'기본 접속용 보안그룹은 보호됩니다.');return g;};
  if(['createInstance','createVolume','createNetwork','createSubnet','createRouter','createGroup','createLoadBalancer','createListener','createPool','createShare','createAlarm','createReservation'].includes(kind))b.name=text(b.name,'이름',100);
  if(['deleteInstance','instanceAction','attachNetwork','detachNetwork','attachGroup','detachGroup','completeIso'].includes(kind))own(params.id);
  if(['createSshForward','deleteSshForward','createPublicRoute','deletePublicRoute','createTcpForward','deleteTcpForward'].includes(kind))own(params.id);
  if(['createTcpForward','createPublicRoute'].includes(kind)){
    if(b.mode==='tcp'||kind==='createTcpForward')b.targetPort=integer(b.targetPort,'대상 포트');
    else{b.port=integer(b.port,'서비스 포트');if(!['http','https'].includes(b.protocol))throw problem(400,'프로토콜을 확인하세요.');}
  }
  if(kind==='createInstance'){
    b.imageRef=text(b.imageRef,'이미지');b.flavorRef=text(b.flavorRef,'Flavor');
    if(!settings.selfServiceVmAllowedFlavors.includes(b.flavorRef))throw problem(403,'허용되지 않은 Flavor입니다.');
    if(!['image','iso'].includes(b.bootSource))throw problem(400,'부팅 방식을 확인하세요.');
    if(b.bootSource==='image'&&!settings.selfServiceVmAllowedImages.includes(b.imageRef))throw problem(403,'허용되지 않은 이미지입니다.');
    if(b.bootSource==='iso'){
      const image=(snapshot.isoImages||[]).find(x=>x.id===b.imageRef);
      if(!image||(String(image.terminal_lab_user_id)!==String(user.id)&&!settings.selfServiceVmAllowedImages.includes(image.name)&&!settings.selfServiceVmAllowedImages.includes(image.id)))throw problem(403,'사용할 수 없는 ISO입니다.');
    }
    network(b.networkId);
    if(!Array.isArray(b.securityGroupNames)||b.securityGroupNames.length>10)throw problem(400,'보안그룹 목록이 잘못되었습니다.');
    for(const name of b.securityGroupNames)if(!snapshot.securityGroups.some(g=>g.name===name))throw problem(403,'현재 프로젝트의 보안그룹만 연결할 수 있습니다.');
    b.bootVolumeSizeGb=b.bootVolumeSizeGb===''?(b.bootSource==='iso'?32:0):integer(b.bootVolumeSizeGb||0,'부팅 볼륨',0,2048);
  }
  if(kind==='instanceAction'&&!['start','stop','reboot'].includes(b.action))throw problem(400,'지원하지 않는 인스턴스 작업입니다.');
  if(kind==='attachNetwork')network(b.networkId);
  if(kind==='detachNetwork'){const port=resource('ports',params.portId);if(port.device_id!==params.id)throw problem(403,'인스턴스에 연결된 포트가 아닙니다.');}
  if(['attachGroup','detachGroup'].includes(kind)){
    const name=kind==='attachGroup'?b.securityGroupName:params.name;
    if(!snapshot.securityGroups.some(g=>g.name===name))throw problem(404,'보안그룹을 찾지 못했습니다.');
    if(kind==='detachGroup'&&name==='terminal-lab.kr')throw problem(403,'기본 접속용 보안그룹은 보호됩니다.');
  }
  if(['deleteVolume','attachVolume','detachVolume'].includes(kind))resource('volumes',params.id);
  if(['attachVolume','detachVolume'].includes(kind))own(b.serverId);
  if(kind==='detachVolume'){
    const volume=resource('volumes',params.id);
    const attachment=(volume.attachments||[]).find(a=>a.server_id===b.serverId&&(a.attachment_id===b.attachmentId||a.id===b.attachmentId));
    if(!attachment)throw problem(403,'해당 VM의 볼륨 연결을 확인하지 못했습니다.');
  }
  if(kind==='createVolume'||kind==='createShare')b.sizeGb=integer(b.sizeGb,'볼륨 크기',1,2048);
  if(kind==='deleteNetwork')network(params.id);
  if(kind==='createSubnet'){network(b.networkId);b.cidr=cidr(b.cidr);}
  if(kind==='deleteSubnet')resource('subnets',params.id);
  if(kind==='createRouter'&&b.externalNetworkId){const n=resource('networks',b.externalNetworkId);if(!n['router:external'])throw problem(400,'외부 네트워크를 선택하세요.');}
  if(['deleteRouter','connectSubnet','disconnectSubnet'].includes(kind))resource('routers',params.id);
  if(kind==='connectSubnet')resource('subnets',b.subnetId);
  if(kind==='disconnectSubnet')resource('subnets',params.subnetId);
  if(['allocateFloatingIp','releaseFloatingIp','associateFloatingIp'].includes(kind)){
    if(!settings.selfServiceVmFloatingIpEnabled)throw problem(403,'Floating IP 기능이 비활성화되어 있습니다.');
    if(kind==='allocateFloatingIp'){if(!resource('networks',b.floatingNetworkId)['router:external'])throw problem(400,'외부 네트워크를 선택하세요.');}
    else resource('floatingIps',params.id);
    if(b.portId)resource('ports',b.portId);
  }
  if(['deleteGroup','createRule'].includes(kind))group(params.id);
  if(kind==='createRule'){
    if(!['ingress','egress'].includes(b.direction)||!['tcp','udp','icmp'].includes(b.protocol))throw problem(400,'보안 규칙을 확인하세요.');
    b.remoteIpPrefix=cidr(b.remoteIpPrefix);
    if(b.protocol!=='icmp'){b.portMin=integer(b.portMin,'시작 포트');b.portMax=integer(b.portMax,'마지막 포트',b.portMin);}
    else{b.portMin=null;b.portMax=null;}
  }
  if(kind==='deleteRule'){const g=snapshot.securityGroups.find(g=>(g.security_group_rules||[]).some(r=>r.id===params.id));if(!g)throw problem(404,'보안 규칙을 찾지 못했습니다.');group(g.id);}
  if(kind==='createLoadBalancer')resource('subnets',b.vipSubnetId);
  if(kind==='deleteLoadBalancer')resource('loadBalancers',params.id);
  if(kind==='createListener'){resource('loadBalancers',b.loadBalancerId);b.protocolPort=integer(b.protocolPort,'포트');}
  if(kind==='deleteListener')resource('loadBalancerListeners',params.id);
  if(kind==='createPool')resource('loadBalancerListeners',b.listenerId);
  if(kind==='deletePool')resource('loadBalancerPools',params.id);
  if(['createMember','deleteMember'].includes(kind))resource('loadBalancerPools',params.id);
  if(kind==='createMember'){
    b.protocolPort=integer(b.protocolPort,'포트');resource('subnets',b.subnetId);
    if(!snapshot.ports.some(p=>p.device_owner?.startsWith('compute')&&(p.fixed_ips||[]).some(ip=>ip.ip_address===b.address&&ip.subnet_id===b.subnetId)))throw problem(403,'현재 프로젝트 VM의 IP만 등록할 수 있습니다.');
  }
  if(kind==='deleteMember'){const member=resource('loadBalancerMembers',params.memberId);if(member.pool_id!==params.id)throw problem(403,'다른 풀의 멤버입니다.');}
  if(kind==='createMonitor'){resource('loadBalancerPools',b.poolId);b.delay=integer(b.delay,'주기',1,3600);b.timeout=integer(b.timeout,'제한 시간',1,b.delay);b.maxRetries=integer(b.maxRetries,'재시도',1,10);}
  if(kind==='deleteMonitor')resource('loadBalancerHealthMonitors',params.id);
  if(kind==='createAlarm')own(b.resourceId);
  if(kind==='deleteAlarm')resource('alarms',params.id);
  if(kind==='deleteReservation')resource('reservations',params.id);
  if(kind==='createReservation'){if(!Number.isFinite(Date.parse(b.startDate))||!Number.isFinite(Date.parse(b.endDate))||Date.parse(b.endDate)<=Date.parse(b.startDate))throw problem(400,'예약 시간을 확인하세요.');b.amount=integer(b.amount,'예약 수',1,100);}
  if(kind==='deleteShare')resource('shares',params.id);
  return b;
}

async function executeInfrastructure(i,kind,{projectName,body:b,params:p,user}){
  const common={...b,projectName};
  switch(kind){
    case 'createInstance':{
      const accessCredentials={username:'cloud',password:randomBytes(24).toString('base64url')};
      const server=await i.createOpenstackServerDirect({...common,ownerUserId:user.id,loginUsername:accessCredentials.username,loginPassword:accessCredentials.password});
      return {...server,...(b.bootSource==='iso'?{}:{accessCredentials})};
    }
    case 'completeIso':return i.completeOpenstackIsoInstall({projectName,serverId:p.id,ownerUserId:user.id,installationConfirmed:b.installationConfirmed===true});
    case 'deleteInstance':return i.deleteOpenstackServer({projectName,serverId:p.id});
    case 'instanceAction':return (b.action==='start'?i.startOpenstackServer:b.action==='stop'?i.stopOpenstackServer:i.rebootOpenstackServer)({projectName,serverId:p.id,hard:false});
    case 'attachNetwork':return i.attachOpenstackServerNetwork({...common,serverId:p.id});
    case 'detachNetwork':return i.detachOpenstackServerNetwork({projectName,serverId:p.id,portId:p.portId});
    case 'attachGroup':return i.addOpenstackServerSecurityGroup({...common,serverId:p.id});
    case 'detachGroup':return i.removeOpenstackServerSecurityGroup({projectName,serverId:p.id,securityGroupName:p.name});
    case 'createVolume':return i.createOpenstackVolume(common);
    case 'deleteVolume':return i.deleteOpenstackVolume({projectName,volumeId:p.id});
    case 'attachVolume':return i.attachOpenstackVolume({...common,volumeId:p.id});
    case 'detachVolume':return i.detachOpenstackVolume({...common,attachmentId:b.attachmentId});
    case 'createNetwork':return i.createOpenstackNetwork(common);
    case 'deleteNetwork':return i.deleteOpenstackNetwork({projectName,networkId:p.id});
    case 'createSubnet':return i.createOpenstackSubnet(common);
    case 'deleteSubnet':return i.deleteOpenstackSubnet({projectName,subnetId:p.id});
    case 'createRouter':return i.createOpenstackRouter(common);
    case 'deleteRouter':return i.deleteOpenstackRouter({projectName,routerId:p.id});
    case 'connectSubnet':return i.connectOpenstackRouterSubnet({...common,routerId:p.id});
    case 'disconnectSubnet':return i.disconnectOpenstackRouterSubnet({projectName,routerId:p.id,subnetId:p.subnetId});
    case 'allocateFloatingIp':return i.allocateOpenstackFloatingIp(common);
    case 'associateFloatingIp':return i.updateOpenstackFloatingIpPort({...common,floatingIpId:p.id});
    case 'releaseFloatingIp':return i.releaseOpenstackFloatingIp({projectName,floatingIpId:p.id});
    case 'createGroup':return i.createOpenstackSecurityGroup(common);
    case 'deleteGroup':return i.deleteOpenstackSecurityGroup({projectName,securityGroupId:p.id});
    case 'createRule':return i.createOpenstackSecurityGroupRule({...common,securityGroupId:p.id});
    case 'deleteRule':return i.deleteOpenstackSecurityGroupRule({projectName,ruleId:p.id});
    case 'createLoadBalancer':return i.createOpenstackLoadBalancer(common);
    case 'deleteLoadBalancer':return i.deleteOpenstackLoadBalancer({projectName,loadBalancerId:p.id});
    case 'createListener':return i.createOpenstackLoadBalancerListener(common);
    case 'deleteListener':return i.deleteOpenstackLoadBalancerListener({projectName,listenerId:p.id});
    case 'createPool':return i.createOpenstackLoadBalancerPool(common);
    case 'deletePool':return i.deleteOpenstackLoadBalancerPool({projectName,poolId:p.id});
    case 'createMember':return i.createOpenstackLoadBalancerMember({...common,poolId:p.id});
    case 'deleteMember':return i.deleteOpenstackLoadBalancerMember({projectName,poolId:p.id,memberId:p.memberId});
    case 'createMonitor':return i.createOpenstackLoadBalancerHealthMonitor(common);
    case 'deleteMonitor':return i.deleteOpenstackLoadBalancerHealthMonitor({projectName,healthMonitorId:p.id});
    case 'createAlarm':return i.createOpenstackAlarm(common);
    case 'deleteAlarm':return i.deleteOpenstackAlarm({projectName,alarmId:p.id});
    case 'createReservation':return i.createOpenstackReservation(common);
    case 'deleteReservation':return i.deleteOpenstackReservation({projectName,leaseId:p.id});
    case 'createShare':return i.createOpenstackShare(common);
    case 'deleteShare':return i.deleteOpenstackShare({projectName,shareId:p.id});
    default:throw problem(400,'지원하지 않는 작업입니다.');
  }
}

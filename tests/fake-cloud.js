// Deterministic infrastructure double. Used only by tests, never by the production entry point.
export function fakeCloud(){
  const data=new Map();let sequence=0;
  const empty=projectName=>({ok:true,driver:'test',projectName,instances:[],volumes:[],networks:[{id:'net-private',name:'private'},{id:'net-external',name:'external','router:external':true}],subnets:[{id:'subnet-private',name:'private',network_id:'net-private',cidr:'192.168.10.0/24'}],routers:[],floatingIps:[],securityGroups:[{id:'group-default',name:'default',security_group_rules:[]},{id:'group-access',name:'terminal-lab.kr',security_group_rules:[]}],ports:[],flavors:[{id:'small',name:'small',vcpus:2,ramMb:4096,diskGb:40}],isoImages:[],loadBalancerAvailable:false,dnsAvailable:false,shareAvailable:false,alarmAvailable:false,reservationAvailable:false,loadBalancers:[],loadBalancerListeners:[],loadBalancerPools:[],loadBalancerMembers:[],loadBalancerHealthMonitors:[],shares:[],shareTypes:[],alarms:[],reservations:[],quota:{metrics:{instances:{used:0,limit:2},cores:{used:0,limit:4},ram:{used:0,limit:8192},gigabytes:{used:0,limit:100}}},warnings:[]});
  return {
    data,
    async provision(project){await new Promise(resolve=>setTimeout(resolve,15));data.set(project.projectName,empty(project.projectName));return {ok:true};},
    async deleteProject(project){data.delete(project.projectName);return {ok:true};},
    async snapshot(name){if(!data.has(name))throw new Error('Missing test project');return {...structuredClone(data.get(name)),refreshedAt:new Date().toISOString()};},
    async execute(kind,{projectName,body,params,user}){
      const snapshot=data.get(projectName);
      if(kind==='createInstance'){
        const server={id:'server-'+(++sequence),name:body.name,status:'ACTIVE',metadata:{terminal_lab_managed:'true',terminal_lab_user_id:String(user.id)},addresses:{private:[{addr:'192.168.10.10',version:4}]},security_groups:[{name:'default'}]};
        snapshot.instances.push(server);return {...server,accessCredentials:{username:'cloud',password:'random-test-vm-password-12345'}};
      }
      if(kind==='deleteInstance'){snapshot.instances=snapshot.instances.filter(s=>s.id!==params.id);return {ok:true};}
      if(kind==='createNetwork'){const network={id:'network-'+(++sequence),name:body.name};snapshot.networks.push(network);return network;}
      if(kind==='deleteNetwork'){snapshot.networks=snapshot.networks.filter(n=>n.id!==params.id);return {ok:true};}
      return {ok:true};
    },
    async console(){return {url:'https://vnc.example.com/vnc_lite.html?token=example'};},
  };
}

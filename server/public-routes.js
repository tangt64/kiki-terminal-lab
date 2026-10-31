import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { problem,integer } from './policy.js';

// Standalone forwarding uses only Community records. No parent HAProxy files are read or written.
export class PublicRoutes {
  constructor({db,cloud,config}){this.db=db;this.cloud=cloud;this.config=config;this.listeners=new Map();this.httpRoutes=new Map();this.sockets=new Set();this.timer=null;}
  capabilities(){return {publicDomainsEnabled:Boolean(this.config.publicBaseDomain||this.config.tcpForwarding),labBaseDomain:this.config.publicBaseDomain,sshPublicHost:this.config.sshPublicHost,tcpForwardingEnabled:this.config.tcpForwarding};}
  hostFor(server){
    const items=Object.values(server.addresses||{}).flat();const host=(items.find(a=>a['OS-EXT-IPS:type']!=='floating'&&a.version===4)||items.find(a=>a.version===4))?.addr;
    if(!net.isIPv4(host)||/^127\.|^169\.254\.|^0\./.test(host))throw problem(409,'VM 내부 IPv4 주소가 준비되지 않았습니다.');return host;
  }
  track(socket){this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));socket.on('error',()=>socket.destroy());return socket;}
  async listen(row){
    const server=net.createServer(client=>{
      const upstream=this.track(net.connect({host:row.targetHost,port:row.targetPort}));this.track(client);
      client.pipe(upstream);upstream.pipe(client);client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
      client.setTimeout(10*60*1000,()=>client.destroy());upstream.setTimeout(10*60*1000,()=>upstream.destroy());
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(row.externalPort,'0.0.0.0',resolve);});
    server.on('error',()=>{});this.listeners.set(row.id,{server,sockets:new Set()});
    server.on('connection',socket=>{const entry=this.listeners.get(row.id);entry?.sockets.add(socket);socket.once('close',()=>entry?.sockets.delete(socket));});
  }
  async start(){
    await this.reconcile();this.timer=setInterval(()=>this.reconcile().catch(()=>{}),30000);this.timer.unref();
  }
  async reconcile(){
    const rows=await this.db.publicRoutes();const snapshots=new Map();const active=new Set();
    for(const row of rows){
      try{
        const user=await this.db.user(row.userId);if(user?.status!=='approved'||(user.role!=='admin'&&!user.selfServiceVmEnabled))continue;
        const project=(await this.db.projects(row.userId)).find(p=>p.projectName===row.projectName&&p.status==='approved');if(!project)continue;
        if(!snapshots.has(row.projectName))snapshots.set(row.projectName,await this.cloud.snapshot(row.projectName));
        const server=snapshots.get(row.projectName).instances.find(s=>s.id===row.serverId);
        if(!server||server.metadata?.terminal_lab_managed!=='true'||String(server.metadata?.terminal_lab_user_id)!==String(row.userId)||this.hostFor(server)!==row.targetHost)continue;
        if(row.kind==='http'&&this.config.publicBaseDomain)this.httpRoutes.set(row.subdomain+'.'+this.config.publicBaseDomain,row);
        else if(this.config.tcpForwarding&&!this.listeners.has(row.id))await this.listen(row);
        active.add(row.id);
      }catch{/* A failed identity/resource check leaves this route closed. */}
    }
    for(const [id,entry]of this.listeners)if(!active.has(id)){entry.server.close();for(const s of entry.sockets)s.destroy();this.listeners.delete(id);}
    for(const [host,row]of this.httpRoutes)if(!active.has(row.id))this.httpRoutes.delete(host);
  }
  async create({projectName,server,user,kind,body}){
    const targetPort=kind==='ssh'?22:integer(body.targetPort||body.port,'서비스 포트');
    const targetHost=this.hostFor(server);
    const existing=(await this.db.publicRoutes(projectName)).filter(r=>r.serverId===server.id);
    if(existing.length>=8)throw problem(409,'VM당 공개 연결은 최대 8개입니다.');
    if(kind==='ssh'&&existing.some(r=>r.kind==='ssh'))return this.present(existing.find(r=>r.kind==='ssh'));
    if(kind==='http'){
      if(!this.config.publicBaseDomain)throw problem(503,'PUBLIC_BASE_DOMAIN과 와일드카드 DNS를 먼저 설정하세요.');
      const subdomain=String(body.subdomain||'vm-'+randomBytes(4).toString('hex')).toLowerCase();
      if(!/^[a-z][a-z0-9-]{2,50}$/.test(subdomain)||['www','admin','api','portal'].includes(subdomain))throw problem(400,'서브도메인은 영문자로 시작하는 영문·숫자·하이픈 3~51자입니다.');
      if(!['http','https'].includes(body.protocol))throw problem(400,'서비스 프로토콜을 확인하세요.');
      const row=await this.db.insertPublicRoute({userId:user.id,projectName,serverId:server.id,kind,targetHost,targetPort,subdomain,protocol:body.protocol});
      this.httpRoutes.set(subdomain+'.'+this.config.publicBaseDomain,row);return this.present(row);
    }
    if(!this.config.tcpForwarding||!this.config.sshPublicHost)throw problem(503,'TCP_FORWARDING_ENABLED와 SSH_PUBLIC_HOST를 먼저 설정하세요.');
    const used=new Set((await this.db.publicRoutes()).map(r=>r.externalPort));
    for(let port=this.config.tcpPortStart;port<=this.config.tcpPortEnd;port++){
      if(used.has(port))continue;
      let row;
      try{row=await this.db.insertPublicRoute({userId:user.id,projectName,serverId:server.id,kind,targetHost,targetPort,externalPort:port});await this.listen(row);return this.present(row);}
      catch(error){if(row)await this.db.deletePublicRoute(row.id);if(error.code!=='EADDRINUSE'&&error.code!=='23505')throw error;}
    }
    throw problem(409,'사용 가능한 외부 TCP 포트가 없습니다.');
  }
  present(row){const {targetHost,...safe}=row;return {...safe,mode:row.kind==='http'?'domain':'tcp',host:this.config.sshPublicHost,externalSshHost:this.config.sshPublicHost,externalSshPort:row.externalPort,externalSshEnabled:row.kind==='ssh',fqdn:row.subdomain?row.subdomain+'.'+this.config.publicBaseDomain:undefined,url:row.subdomain?'https://'+row.subdomain+'.'+this.config.publicBaseDomain:undefined,command:row.kind==='ssh'?`ssh cloud@${this.config.sshPublicHost} -p ${row.externalPort}`:undefined};}
  async remove({projectName,serverId,subdomain,port,kind}){
    const rows=(await this.db.publicRoutes(projectName)).filter(r=>r.serverId===serverId&&(!kind||r.kind===kind)&&(!subdomain||r.subdomain===subdomain)&&(!port||r.externalPort===Number(port)));
    for(const row of rows){const entry=this.listeners.get(row.id);if(entry){entry.server.close();for(const s of entry.sockets)s.destroy();this.listeners.delete(row.id);}for(const [host,value]of this.httpRoutes)if(value.id===row.id)this.httpRoutes.delete(host);await this.db.deletePublicRoute(row.id);}
    return {ok:true};
  }
  middleware(){return(req,res,next)=>{
    const host=String(req.headers.host||'').split(':')[0].toLowerCase();const route=this.httpRoutes.get(host);
    if(!route){if(this.config.publicBaseDomain&&host.endsWith('.'+this.config.publicBaseDomain)){res.statusCode=404;res.end('Published route not found');return;}return next();}
    const transport=route.protocol==='https'?https:http;
    const upstream=transport.request({hostname:route.targetHost,port:route.targetPort,method:req.method,path:req.url,headers:{...req.headers,'x-forwarded-host':host,'x-forwarded-proto':'https'},rejectUnauthorized:true,timeout:30000},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.statusCode=502;res.end('Published service unavailable');});upstream.on('timeout',()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  };}
  shutdown(){clearInterval(this.timer);for(const entry of this.listeners.values()){entry.server.close();for(const socket of entry.sockets)socket.destroy();}for(const socket of this.sockets)socket.destroy();this.listeners.clear();this.httpRoutes.clear();}
}

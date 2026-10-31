import { randomBytes,createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { ServerResponse } from 'node:http';
import { Client } from 'ssh2';
import WebSocket,{WebSocketServer} from 'ws';
import { problem } from './policy.js';

export function consoleWebSocketUrl(value){
  const url=new URL(value);
  if(!['https:','http:','wss:','ws:'].includes(url.protocol))throw problem(502,'지원하지 않는 VNC 주소입니다.');
  if(url.protocol==='https:')url.protocol='wss:';
  if(url.protocol==='http:')url.protocol='ws:';
  if(/\.html$/.test(url.pathname)){
    const upstreamPath=url.searchParams.get('path');
    const token=url.searchParams.get('token');
    const target=new URL(upstreamPath?(upstreamPath.startsWith('/')?upstreamPath:'/'+upstreamPath):'/websockify',url);
    if(target.origin!==url.origin)throw problem(502,'VNC 경로가 잘못되었습니다.');
    if(token&&!target.searchParams.has('token'))target.searchParams.set('token',token);
    return target.toString();
  }
  return url.toString();
}

export class Terminals {
  constructor({db,config}){this.db=db;this.config=config;this.pending=new Map();this.wss=new WebSocketServer({noServer:true,maxPayload:65536});this.timer=setInterval(()=>this.expire(),30000);this.timer.unref();}
  add(req,type,data){
    if([...this.pending.values()].filter(s=>s.userId===req.user.id).length>=5)throw problem(429,'열린 콘솔을 닫은 뒤 다시 연결하세요.');
    const id=randomBytes(32).toString('hex');
    this.pending.set(id,{userId:req.user.id,sessionId:req.sessionID,type,...data,expires:Date.now()+60000,cleanup:()=>{}});
    return {sessionId:id,wsPath:`/api/terminal/socket/${id}`,targetLabel:data.host||'VNC'};
  }
  async vnc(req,url){const entry=this.add(req,'vnc',{url:consoleWebSocketUrl(url)});return {...entry,consoleUrl:'/console?session='+entry.sessionId};}
  async ssh(req,{server,username,password}){
    if(!this.config.fingerprints.length)throw problem(503,'관리자가 SSH_HOST_FINGERPRINTS에 VM 호스트 키를 등록해야 합니다. VNC 콘솔은 별도로 사용할 수 있습니다.');
    const addresses=Object.values(server.addresses||{}).flat();
    const host=(addresses.find(a=>a['OS-EXT-IPS:type']==='floating')||addresses.find(a=>a.version===4)||addresses[0])?.addr;
    if(!isIP(host)||host==='::1'||/^127\.|^169\.254\.|^0\./.test(host))throw problem(409,'접속 가능한 VM IP 주소가 준비되지 않았습니다.');
    return this.add(req,'ssh',{host,username,password});
  }
  expire(){for(const [id,s]of this.pending)if(s.expires<Date.now())this.close(id,s.userId);}
  close(id,userId){const s=this.pending.get(id);if(s&&s.userId===userId){this.pending.delete(id);s.password='';s.cleanup();}}
  attach(server,sessions){
    server.on('upgrade',(req,socket,head)=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      const match=pathname.match(/^\/api\/terminal\/socket\/([a-f0-9]{64})$/);
      if(!match||req.headers.origin!==this.config.publicUrl){socket.destroy();return;}
      sessions(req,new ServerResponse(req),async error=>{
        try{
          if(error)throw error;
          const entry=this.pending.get(match[1]);
          const user=req.session?.userId?await this.db.user(req.session.userId):null;
          if(!entry||entry.connected||entry.expires<Date.now()||!user||user.status!=='approved'||entry.userId!==user.id||entry.sessionId!==req.sessionID)throw new Error('Unauthorized');
          entry.connected=true;entry.expires=Date.now()+60*60*1000;
          this.wss.handleUpgrade(req,socket,head,ws=>this.connect(ws,entry,match[1]));
        }catch{socket.destroy();}
      });
    });
  }
  connect(ws,entry,id){
    const send=value=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
    const authorization=setInterval(async()=>{
      try{const user=await this.db.user(entry.userId);const sess=await this.db.one('SELECT sid FROM sessions WHERE sid=$1 AND expires_at>now()',[entry.sessionId]);if(!user||user.status!=='approved'||!sess)this.close(id,entry.userId);}
      catch{this.close(id,entry.userId);}
    },30000);
    authorization.unref();
    let connection;let stream;let upstream;
    entry.cleanup=()=>{clearInterval(authorization);connection?.end();upstream?.close();ws.close();};
    ws.on('close',()=>this.close(id,entry.userId));
    ws.on('error',()=>this.close(id,entry.userId));
    if(entry.type==='vnc'){
      // TLS verification stays enabled; private CA is the same one used for OpenStack.
      import('./infrastructure/openstack-fetch.js').then(({getOpenstackRequestCaBundle})=>{
        if(ws.readyState!==WebSocket.OPEN)return;
        upstream=new WebSocket(entry.url,{rejectUnauthorized:true,ca:getOpenstackRequestCaBundle(),handshakeTimeout:15000});
        upstream.on('open',()=>ws.on('message',data=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary:true});}));
        upstream.on('message',data=>{if(ws.readyState===WebSocket.OPEN)ws.send(data,{binary:true});});
        upstream.on('error',()=>this.close(id,entry.userId));upstream.on('close',()=>this.close(id,entry.userId));
      }).catch(()=>this.close(id,entry.userId));
      return;
    }
    connection=new Client();
    connection.on('ready',()=>{
      entry.password='';
      connection.shell({term:'xterm-256color',cols:100,rows:30},(error,channel)=>{
        if(error){send({type:'error',message:'SSH 셸을 시작하지 못했습니다.'});return this.close(id,entry.userId);}
        stream=channel;stream.on('data',data=>send({type:'data',data:data.toString('utf8')}));stream.stderr.on('data',data=>send({type:'data',data:data.toString('utf8')}));stream.on('close',()=>this.close(id,entry.userId));
      });
    });
    connection.on('error',()=>{send({type:'error',message:'SSH 인증 또는 호스트 키 확인에 실패했습니다.'});this.close(id,entry.userId);});
    ws.on('message',raw=>{
      entry.expires=Date.now()+15*60*1000;
      try{const message=JSON.parse(raw);if(message.type==='input'&&typeof message.data==='string'&&message.data.length<=16384)stream?.write(message.data);else if(message.type==='resize'){const rows=Math.max(2,Math.min(200,Number(message.rows)||30));const cols=Math.max(10,Math.min(400,Number(message.cols)||100));stream?.setWindow(rows,cols,0,0);}}catch{}
    });
    connection.connect({host:entry.host,port:22,username:entry.username,password:entry.password,readyTimeout:20000,keepaliveInterval:15000,hostVerifier:key=>this.config.fingerprints.includes('SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,''))});
  }
  shutdown(){clearInterval(this.timer);for(const [id,s]of this.pending)this.close(id,s.userId);this.wss.close();}
}

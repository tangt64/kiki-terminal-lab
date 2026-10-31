import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import test from 'node:test';
import {PublicRoutes} from '../server/public-routes.js';

test('standalone TCP forwarding transports bytes and is revoked when the owner is disabled',async()=>{
  const target=net.createServer(socket=>socket.pipe(socket));await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const row={id:1,userId:2,projectName:'test-project',serverId:'test-vm',kind:'tcp',targetHost:'127.0.0.1',targetPort:target.address().port,externalPort:0};
  const routes=new PublicRoutes({db:{publicRoutes:async()=>[row],user:async()=>({status:'disabled'})},cloud:{},config:{tcpForwarding:true}});
  try{
    await routes.listen(row);const port=routes.listeners.get(1).server.address().port;
    const result=await new Promise((resolve,reject)=>{const client=net.connect(port,'127.0.0.1',()=>client.write('community-forward-test'));client.once('data',data=>{client.destroy();resolve(data.toString());});client.on('error',reject);});
    assert.equal(result,'community-forward-test');await routes.reconcile();assert.equal(routes.listeners.size,0);
  }finally{routes.shutdown();await new Promise(resolve=>target.close(resolve));}
});
test('published HTTP hosts route to their VM and unknown wildcard hosts never reach the portal',async()=>{
  const target=http.createServer((req,res)=>{res.writeHead(201,{'content-type':'text/plain'});res.end('vm:'+req.url);});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const routes=new PublicRoutes({db:{},cloud:{},config:{publicBaseDomain:'apps.example.test'}});
  routes.httpRoutes.set('service.apps.example.test',{targetHost:'127.0.0.1',targetPort:target.address().port,protocol:'http'});
  const handler=routes.middleware();const proxy=http.createServer((req,res)=>handler(req,res,()=>res.end('portal')));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const request=host=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:proxy.address().port,path:'/health',headers:{host}},response=>{let body='';response.on('data',data=>body+=data);response.on('end',()=>resolve({status:response.statusCode,body}));}).on('error',reject);});
  try{assert.deepEqual(await request('service.apps.example.test'),{status:201,body:'vm:/health'});assert.equal((await request('unknown.apps.example.test')).status,404);assert.equal((await request('portal.example.test')).body,'portal');}
  finally{routes.shutdown();await new Promise(resolve=>proxy.close(resolve));await new Promise(resolve=>target.close(resolve));}
});

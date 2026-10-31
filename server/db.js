import fs from 'node:fs/promises';
import pg from 'pg';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS } from './config.js';

export function normalize(row) {
  if (!row) return null;
  const result = Object.fromEntries(Object.entries(row).map(([key,value]) => [key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()), value instanceof Date ? value.toISOString() : value]));
  for (const key of ['id','userId','actorId','reviewedBy']) if(result[key] != null) result[key] = Number(result[key]);
  if(result.config) Object.assign(result,{networkName:result.config.networkName,subnetCidr:result.config.subnetCidr,requestedQuota:result.config.quota,requestedProjectName:result.projectName});
  return result;
}
export function publicUser(user) {
  if (!user) return null;
  const {passwordHash,...safe}=user;
  return safe;
}

export class Database {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString, max: 10 }); }
  async query(sql, values=[]) { return this.pool.query(sql,values); }
  async rows(sql,values=[]) {return (await this.query(sql,values)).rows.map(normalize);}
  async one(sql,values=[]) {return (await this.rows(sql,values))[0] || null;}
  async transaction(fn) {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async migrate(initialAdmin) {
    const schema=await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8');
    await this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(40802026)');
      const existing=(await client.query("SELECT to_regclass('public.users') AS users,to_regclass('public.community_migrations') AS community")).rows[0];
      if(existing.users&&!existing.community)throw new Error('Refusing to initialize a non-community database. Use a new, dedicated database.');
      await client.query(schema);
      await client.query('INSERT INTO settings(id,value) VALUES (1,$1) ON CONFLICT DO NOTHING',[JSON.stringify(DEFAULT_SETTINGS)]);
      if (Number((await client.query('SELECT count(*) FROM users')).rows[0].count)===0) {
        if (!initialAdmin?.password || initialAdmin.password.length < 12 || Buffer.byteLength(initialAdmin.password,'utf8')>72 || /REPLACE|change-me/i.test(initialAdmin.password)) throw new Error('A unique INITIAL_ADMIN_PASSWORD of at least 12 characters and at most 72 UTF-8 bytes is required for an empty database');
        await client.query("INSERT INTO users(username,name,password_hash,role,status,self_service_vm_enabled) VALUES ($1,$2,$3,'admin','approved',true)",[initialAdmin.username.toLowerCase(),initialAdmin.name,await bcrypt.hash(initialAdmin.password,12)]);
      }
    });
  }
  user(id){return this.one('SELECT * FROM users WHERE id=$1',[id]);}
  userByName(name){return this.one('SELECT * FROM users WHERE username=$1',[name]);}
  users(){return this.rows('SELECT * FROM users ORDER BY id');}
  createUser({username,name,email,passwordHash}){return this.one('INSERT INTO users(username,name,email,password_hash) VALUES ($1,$2,$3,$4) RETURNING *',[username,name,email,passwordHash]);}
  async patchUser(id,patch) {
    return this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(40802027)');
      const current=normalize((await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0]);
      if(!current) return null;
      const next={...current,...patch};
      if(current.role==='admin'&&current.status==='approved'&&(next.role!=='admin'||next.status!=='approved')){
        const count=Number((await client.query("SELECT count(*) FROM users WHERE role='admin' AND status='approved'")).rows[0].count);
        if(count<=1) throw Object.assign(new Error('마지막 활성 관리자의 권한은 해제할 수 없습니다.'),{statusCode:409});
      }
      const updated=normalize((await client.query('UPDATE users SET role=$2,status=$3,self_service_vm_enabled=$4,name=$5,email=$6,password_hash=$7 WHERE id=$1 RETURNING *',[id,next.role,next.status,next.selfServiceVmEnabled,next.name,next.email,next.passwordHash])).rows[0]);
      if(next.status!=='approved'||patch.passwordHash) await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1",[String(id)]);
      return updated;
    });
  }
  async settings(){const row=await this.one('SELECT value FROM settings WHERE id=1');return {...DEFAULT_SETTINGS,...row.value};}
  async saveSettings(value){await this.query('UPDATE settings SET value=$1 WHERE id=1',[JSON.stringify(value)]);return value;}
  projects(userId=null){return this.rows('SELECT p.*,u.username,u.name AS user_name FROM project_requests p JOIN users u ON u.id=p.user_id'+(userId===null?'':' WHERE p.user_id=$1')+' ORDER BY p.id DESC',userId===null?[]:[userId]);}
  project(id){return this.one('SELECT * FROM project_requests WHERE id=$1',[id]);}
  createProject(userId,name,config){return this.one('INSERT INTO project_requests(user_id,project_name,config) VALUES ($1,$2,$3) RETURNING *',[userId,name,JSON.stringify(config)]);}
  claimProject(id,expected,status,reviewer){return this.one('UPDATE project_requests SET status=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 AND status=ANY($2) RETURNING *',[id,expected,status,reviewer]);}
  updateProject(id,status,result,note=''){return this.one('UPDATE project_requests SET status=$2,result=$3,review_note=$4 WHERE id=$1 RETURNING *',[id,status,JSON.stringify(result),note]);}
  actions(userId=null){return this.rows('SELECT a.*,u.username FROM cloud_actions a JOIN users u ON u.id=a.user_id'+(userId===null?'':' WHERE a.user_id=$1')+' ORDER BY a.id DESC LIMIT 500',userId===null?[]:[userId]);}
  action(id){return this.one('SELECT * FROM cloud_actions WHERE id=$1',[id]);}
  async createAction(userId,projectName,operation,request,status){
    return this.transaction(async client=>{
      const project=(await client.query("SELECT * FROM project_requests WHERE project_name=$1 AND status='approved' FOR UPDATE",[projectName])).rows[0];
      if(!project)throw Object.assign(new Error('프로젝트가 승인 상태가 아닙니다.'),{statusCode:409});
      return normalize((await client.query('INSERT INTO cloud_actions(user_id,project_name,operation,request,status) VALUES ($1,$2,$3,$4,$5) RETURNING *',[userId,projectName,operation,JSON.stringify(request),status])).rows[0]);
    });
  }
  async claimProjectDeletion(id,reviewer){
    return this.transaction(async client=>{
      const project=(await client.query("SELECT * FROM project_requests WHERE id=$1 AND status='approved' FOR UPDATE",[id])).rows[0];
      if(!project)return null;
      const active=(await client.query("SELECT id FROM cloud_actions WHERE project_name=$1 AND status='executing' LIMIT 1",[project.project_name])).rows.length;
      if(active)return null;
      await client.query("UPDATE cloud_actions SET status='rejected',error_message='프로젝트 삭제로 취소되었습니다.' WHERE project_name=$1 AND status='requested'",[project.project_name]);
      return normalize((await client.query("UPDATE project_requests SET status='deleting',reviewed_by=$2,reviewed_at=now() WHERE id=$1 RETURNING *",[id,reviewer])).rows[0]);
    });
  }
  async claimAction(id,reviewer,status='executing'){
    return this.transaction(async client=>{
      const action=(await client.query("SELECT * FROM cloud_actions WHERE id=$1 AND status='requested'",[id])).rows[0];
      if(!action)return null;
      // Same row lock as createAction/deletion: approval cannot start behind an in-flight project deletion.
      const project=(await client.query("SELECT id FROM project_requests WHERE project_name=$1 AND status='approved' FOR UPDATE",[action.project_name])).rows[0];
      if(!project)return null;
      return normalize((await client.query("UPDATE cloud_actions SET status=$3,reviewed_by=$2,reviewed_at=now() WHERE id=$1 AND status='requested' RETURNING *",[id,reviewer,status])).rows[0]);
    });
  }
  updateAction(id,status,result={},error=''){return this.one('UPDATE cloud_actions SET status=$2,result=$3,error_message=$4,executed_at=now() WHERE id=$1 RETURNING *',[id,status,JSON.stringify(result),error]);}
  audit(actorId,action,detail={}){return this.query('INSERT INTO audit_logs(actor_id,action,detail) VALUES ($1,$2,$3)',[actorId,action,JSON.stringify(detail)]);}
  auditLogs(){return this.rows('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300');}
  publicRoutes(projectName=null){return this.rows('SELECT * FROM public_routes'+(projectName?' WHERE project_name=$1':''),projectName?[projectName]:[]);}
  insertPublicRoute(r){return this.one('INSERT INTO public_routes(user_id,project_name,server_id,kind,target_host,target_port,external_port,subdomain,protocol) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[r.userId,r.projectName,r.serverId,r.kind,r.targetHost,r.targetPort,r.externalPort||null,r.subdomain||null,r.protocol||'http']);}
  deletePublicRoute(id){return this.query('DELETE FROM public_routes WHERE id=$1',[id]);}
  async recoverInterruptedOperations(){
    await this.query("UPDATE cloud_actions SET status='failed',error_message='서버가 작업 도중 재시작되었습니다. 실제 OpenStack 자원을 확인한 뒤 재시도하세요.' WHERE status='executing'");
    await this.query("UPDATE project_requests SET status='failed',review_note='작업 도중 서버 재시작. 실제 자원을 확인한 뒤 관리자가 재시도해야 합니다.' WHERE status IN ('provisioning','deleting')");
  }
  async close(){await this.pool.end();}
}

export class PostgresSessions extends session.Store {
  constructor(db){super();this.db=db;}
  get(sid,callback){this.db.one('SELECT sess FROM sessions WHERE sid=$1 AND expires_at>now()',[sid]).then(row=>callback(null,row?.sess||null),callback);}
  set(sid,sess,callback=()=>{}){const expires=sess.cookie?.expires||new Date(Date.now()+8*60*60*1000);this.db.query('INSERT INTO sessions(sid,sess,expires_at) VALUES ($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=$2,expires_at=$3',[sid,JSON.stringify(sess),expires]).then(()=>callback(),callback);}
  destroy(sid,callback=()=>{}){this.db.query('DELETE FROM sessions WHERE sid=$1',[sid]).then(()=>callback(),callback);}
  touch(sid,sess,callback=()=>{}){this.db.query('UPDATE sessions SET expires_at=$2 WHERE sid=$1',[sid,sess.cookie.expires]).then(()=>callback(),callback);}
}

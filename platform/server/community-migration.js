import fs from 'node:fs/promises';
import pg from 'pg';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {createVault} from '../../server/secrets.js';
import {PRODUCT_NAME, PRODUCT_VERSION} from '../shared/product.js';

function convertedSecret(password,secret){const key=createHash('sha256').update(secret).digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(part=>part.toString('base64url')).join('.');}
export async function migratePlatform(config){
  const client=new pg.Client({connectionString:config.databaseUrl});await client.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(40802026)');
    const existing=(await client.query("SELECT to_regclass('public.users') AS users,to_regclass('public.community_migrations') AS core,to_regclass('public.community_platform_migrations') AS platform")).rows[0];
    if(existing.users&&!existing.core&&!existing.platform)throw new Error('Refusing to modify an existing non-Community database. Use a dedicated database.');
    const migrated=existing.platform?Boolean((await client.query('SELECT version FROM community_platform_migrations WHERE version=201')).rows.length):false;
    const core=Boolean(existing.core&&!migrated);
    if(core){
      await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check; ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;");
      // Preserve existing core accounts; the original platform stores booleans as integer flags.
      await client.query("ALTER TABLE users ALTER COLUMN self_service_vm_enabled DROP DEFAULT; ALTER TABLE users ALTER COLUMN self_service_vm_enabled TYPE INTEGER USING self_service_vm_enabled::int; ALTER TABLE users ALTER COLUMN self_service_vm_enabled SET DEFAULT 0;");
      const extras=["signup_reason TEXT NOT NULL DEFAULT ''","user_source TEXT NOT NULL DEFAULT 'self_signup'","approval_mail_sent_at TEXT","otp_enabled INTEGER NOT NULL DEFAULT 0","otp_secret TEXT NOT NULL DEFAULT ''","support_message_enabled INTEGER NOT NULL DEFAULT 0","poc_free_access_enabled INTEGER NOT NULL DEFAULT 0","instructor_share_enabled INTEGER NOT NULL DEFAULT 0","admin_permissions_json TEXT NOT NULL DEFAULT '[]'"];
      for(const column of extras)await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS '+column);
      await client.query("UPDATE users SET role='student' WHERE role='user'");
      await client.query('ALTER TABLE users ALTER COLUMN created_at TYPE TEXT USING created_at::text');
      // Sessions use a different serialization contract. Expire them, preserving all account data.
      await client.query('DROP TABLE IF EXISTS sessions');
    }
    await client.query(await fs.readFile(new URL('./postgres-schema.sql',import.meta.url),'utf8'));
    if(Number((await client.query('SELECT count(*) FROM users')).rows[0].count)===0&&(!config.initialAdmin.password||config.initialAdmin.password.length<12||Buffer.byteLength(config.initialAdmin.password)>72))throw new Error('Set a unique INITIAL_ADMIN_PASSWORD before installing an empty Community database.');
    await client.query('CREATE TABLE IF NOT EXISTS community_platform_migrations(version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('INSERT INTO community_platform_migrations(version) VALUES(2) ON CONFLICT DO NOTHING');
    await client.query('COMMIT');
    const runtime=await import('./db-runtime.js');await runtime.runtimeEnsureSchema();
    if(core){
      // The legacy import runs after schema setup. Mark completion only after all
      // records and encrypted credentials are transferred, allowing a safe retry.
      const projects=(await client.query('SELECT * FROM project_requests')).rows;
      for(const p of projects)await client.query(`INSERT INTO self_service_project_requests(id,user_id,status,requested_project_name,project_name,network_name,subnet_cidr,network_requests_json,note,review_note,reviewed_by,created_at,reviewed_at,quota_profile_id,requested_quota_json) VALUES($1,$2,$3,$4,$4,$5,$6,$7,'',$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,[p.id,p.user_id,p.status,p.project_name,p.config.networkName||'',p.config.subnetCidr||'',JSON.stringify([{networkName:p.config.networkName,subnetCidr:p.config.subnetCidr,routerEnabled:true}]),p.review_note,p.reviewed_by,p.created_at.toISOString(),p.reviewed_at?.toISOString()||null,p.config.quotaProfileId||'basic',JSON.stringify(p.config.quota||{})]);
      const vault=createVault(config.credentialKey);
      for(const a of (await client.query('SELECT * FROM cloud_actions')).rows){
        const result={...a.result};if(result.accessCredentialsEncrypted){const credentials=vault.decrypt(result.accessCredentialsEncrypted);delete result.accessCredentialsEncrypted;result.credentialUsername=credentials.username;result.credentialSecret=convertedSecret(credentials.password,config.sessionSecret);}
        await client.query(`INSERT INTO cloud_console_actions(id,user_id,project_name,operation,request_json,status,estimated_monthly_cost,result_json,error_message,reviewed_by,created_at,reviewed_at,executed_at) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING`,[a.id,a.user_id,a.project_name,a.operation,JSON.stringify(a.request),a.status,JSON.stringify(result),a.error_message,a.reviewed_by,a.created_at.toISOString(),a.reviewed_at?.toISOString()||null,a.executed_at?.toISOString()||null]);
      }
      const oldSettings=(await client.query('SELECT value FROM settings WHERE id=1')).rows[0]?.value;
      if(oldSettings)await runtime.runtimeUpdatePlatformStatus(oldSettings);
      await client.query('INSERT INTO community_platform_migrations(version) VALUES(201) ON CONFLICT DO NOTHING');
    }
    if(!(await client.query('SELECT version FROM community_platform_migrations WHERE version=202')).rows.length){
      const current=await runtime.runtimeGetPlatformStatus();
      await runtime.runtimeUpdatePlatformStatus({serviceProjectName:process.env.OPENSTACK_SERVICE_PROJECT_NAME||current.serviceProjectName,portalUiMode:'v2',userPortalV2Enabled:true,arenaEnabled:false,landingScheduleEnabled:false,landingCurriculumEnabled:false,siteVersionNumber:'v0.2.2',landingHeroTitle:'Terminal Lab Community',landingHeroCopy:'클라우드·협업·운영을 한곳에서 관리합니다.',landingAuthCopy:'승인된 계정으로 사용자 포털과 관리자 콘솔을 이용합니다.'});
      await client.query('INSERT INTO community_platform_migrations(version) VALUES(202) ON CONFLICT DO NOTHING');
    }
    if(!(await client.query('SELECT version FROM community_platform_migrations WHERE version=203')).rows.length){
      const current=await runtime.runtimeGetPlatformStatus();
      // Clear only the exact endpoints inherited from the former bundled defaults.
      // Fingerprints keep the old deployment's addresses out of new source releases.
      const oldEndpoints=new Set(['1b77b2907c709b3582f4a9053e267b2996a43497ae17ad6fe84c30f75393669f','0a177f4b5b5cf8d6e376c5650acb5126f374725d164b75a63eab1e9378951583']);
      const inherited=oldEndpoints.has(createHash('sha256').update(String(current.llmApiUrl||'').trim()).digest('hex'));
      await runtime.runtimeUpdatePlatformStatus({siteVersionNumber:'v0.2.2',...(inherited?{llmApiUrl:'',llmEnabled:false}:{})});
      await client.query('INSERT INTO community_platform_migrations(version) VALUES(203) ON CONFLICT DO NOTHING');
    }
    if(!(await client.query('SELECT version FROM community_platform_migrations WHERE version=204')).rows.length){
      const current=await runtime.runtimeGetPlatformStatus();
      // Change only shipped branding defaults; preserve operator-provided names and assets.
      const patch={};
      if(current.landingHeroTitle==='Terminal Lab Community')patch.landingHeroTitle=PRODUCT_NAME;
      if(current.otpIssuerName==='Terminal Lab')patch.otpIssuerName=PRODUCT_NAME;
      if(current.mailFromName==='Terminal Lab')patch.mailFromName=PRODUCT_NAME;
      if(/^v?0\.[12]\.\d+$/.test(String(current.siteVersionNumber||'')))patch.siteVersionNumber='v'+PRODUCT_VERSION;
      if(Object.keys(patch).length)await runtime.runtimeUpdatePlatformStatus(patch);
      await client.query('INSERT INTO community_platform_migrations(version) VALUES(204) ON CONFLICT DO NOTHING');
    }
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{await client.end();}
}

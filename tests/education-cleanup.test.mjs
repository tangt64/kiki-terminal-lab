import os from 'node:os';import path from 'node:path';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {randomBytes}from'node:crypto';import pg from'pg';
import {REMOVED_EDUCATION_TABLES,archiveEducationTables,separateLegacyBackup}from'../platform/server/education-schema-cleanup.js';
test('active schema creates no retired education tables',()=>{
 const schema=fs.readFileSync(new URL('../platform/server/postgres-schema.sql',import.meta.url),'utf8');
 assert.equal(REMOVED_EDUCATION_TABLES.length,25);
 const server=fs.readFileSync(new URL('../platform/server/index.js',import.meta.url),'utf8');assert.doesNotMatch(server,/await null|function (?:grantPackageContents|loadLabExam|closeExamTerminalSessionIfUnavailable)\b/);
 for(const table of REMOVED_EDUCATION_TABLES)assert.doesNotMatch(schema,new RegExp('(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) '+table+'\\b'));
});
test('old populated backup records move to the generic archive without losing general rows',()=>{
 const original={tables:{users:{rows:[{id:1,name:'operator'}]},courses:{rowCount:1,rows:[{id:7,content:{kept:true}}]},lab_requests:{rows:[]}},dumps:{}};
 const copy=structuredClone(original),next=separateLegacyBackup(original);
 assert.deepEqual(original,copy);assert.deepEqual(next.tables.users,original.tables.users);
 assert.deepEqual(next.tables.community_legacy_records.rows,[{source_table:'courses',row_index:1,row_data:original.tables.courses.rows[0]}]);assert.ok(!next.tables.courses);
});
test('chunked old backup data is preserved and incomplete or duplicate sources fail before restore',()=>{
 const next=separateLegacyBackup({tables:{},dumps:{courses:{format:'json-row-chunks-v1',rowCount:1,chunks:[{rowCount:1,rows:[{id:1}]}]}}});assert.equal(next.tables.community_legacy_records.rows.length,1);
 for(const value of [{},{rows:[],rowCount:1},{rows:[],truncated:true},{rows:'invalid'},{chunks:[{rows:[],rowCount:1}]}])assert.throws(()=>separateLegacyBackup({tables:{courses:value}}));
 assert.throws(()=>separateLegacyBackup({tables:{courses:{rows:[{id:1}]}},dumps:{courses:{rows:[]}}}));
 assert.throws(()=>separateLegacyBackup({tables:{community_legacy_records:{rows:[{source_table:'courses',row_index:1,row_data:{}}]},courses:{rows:[{id:1}]}}}));
});
test('general hook no longer synthesizes education responses or issues education loads',()=>{
 const s=fs.readFileSync(new URL('../platform/client/src/portal-state.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/emptyEducationResponse|(?:function|const) (?:loadCourses|loadLabs|loadWrittenExams|loadLabExams|loadPayments|onPurchaseCourse)\b/);
 for(const handler of ['onCreateCustomLabTerminalSession','onPublishLabDomain','onUnpublishLabDomain','onLogin','onSavePlatformSettings','onCreateQna'])assert.match(s,new RegExp('function '+handler+'\\b'));
});
const target=process.env.TEST_EDUCATION_CLEANUP_DATABASE_URL;
test('installed data migration, archive protection and actual old/new backup restore',{skip:!target,timeout:30000},async t=>{
 assert.match(new URL(target).pathname,/^\/community_test_[a-z0-9_]+$/);
 Object.assign(process.env,{DATABASE_URL:target,SESSION_SECRET:randomBytes(32).toString('hex'),CREDENTIAL_KEY:randomBytes(32).toString('hex'),INITIAL_ADMIN_PASSWORD:randomBytes(16).toString('hex'),DATA_ROOT_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'community-separation-'))});
 const db=new pg.Client({connectionString:target});await db.connect();let runtime;
 try{
  const {getConfig}=await import('../server/config.js'),{migratePlatform}=await import('../platform/server/community-migration.js');
  assert.equal(getConfig().databaseUrl,target);await migratePlatform(getConfig());runtime=await import('../platform/server/db-runtime.js');
  await db.query("INSERT INTO users(id,name,username,password_hash,role,status,created_at)VALUES(1,'preserved operator','operator','fixture-hash','admin','approved',CURRENT_TIMESTAMP::text)");
  for(const name of REMOVED_EDUCATION_TABLES)await db.query('CREATE TABLE "'+name+'"(id bigint primary key,user_id bigint REFERENCES users(id),payload jsonb)');
  await db.query(`INSERT INTO courses VALUES(7,1,'{"nested":[true,42,null]}');INSERT INTO lab_requests VALUES(8,1,'{"credential":"fixture-encrypted"}')`);
  await db.query("INSERT INTO qna_posts(id,user_id,course_id,lab_request_id,title,body,created_at)VALUES(9,1,7,8,'General question','Keep this post',CURRENT_TIMESTAMP::text)");
  await db.query('ALTER TABLE qna_posts ADD CONSTRAINT fixture_course_link FOREIGN KEY(course_id) REFERENCES courses(id)');
  const before=(await db.query('SELECT to_jsonb(t) AS data FROM qna_posts t')).rows;
  const oldBackup=await runtime.runtimeExportBackupData();
  await t.test('operator-managed external links cause a rollback, not cascading loss',async()=>{
   await db.query('CREATE TABLE operator_links(id bigint references courses(id))');await db.query('BEGIN');await assert.rejects(()=>archiveEducationTables(db),/operator-managed/);await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int AS count FROM courses')).rows[0].count,1);await db.query('DROP TABLE operator_links');
  });
  await t.test('archive operations are transactional',async()=>{
   await db.query('BEGIN');const result=await archiveEducationTables(db);assert.equal(result.removed.length,25);assert.equal(result.archivedRows,2);await db.query('ROLLBACK');assert.ok((await db.query("SELECT to_regclass('courses') AS name")).rows[0].name);
  });
  await migratePlatform(getConfig());
  await t.test('general rows, legacy IDs and retired payloads survive upgrade',async()=>{
   assert.deepEqual((await db.query('SELECT to_jsonb(t) AS data FROM qna_posts t')).rows,before);
   for(const name of REMOVED_EDUCATION_TABLES)assert.equal((await db.query('SELECT to_regclass($1) AS name',['public.'+name])).rows[0].name,null);
   assert.deepEqual((await db.query("SELECT row_data FROM community_legacy_records WHERE source_table='courses'")).rows[0].row_data.payload,{nested:[true,42,null]});
   assert.equal((await runtime.runtimeListUsers()).length,1);assert.equal((await runtime.runtimeListQnaPosts()).length,1);
  });
  await t.test('actual old backup restores general data and archives populated education records',async()=>{
   await db.query("UPDATE qna_posts SET body='modified';DELETE FROM community_legacy_records");await runtime.runtimeImportBackupData({database:oldBackup});
   assert.equal((await db.query('SELECT body FROM qna_posts WHERE id=9')).rows[0].body,'Keep this post');
   assert.deepEqual((await db.query("SELECT row_data FROM community_legacy_records WHERE source_table='courses'")).rows[0].row_data,oldBackup.tables.courses.rows[0]);
  });
  await t.test('new backup round-trips the archive and invalid old data never truncates general rows',async()=>{
   const next=await runtime.runtimeExportBackupData();await db.query('DELETE FROM community_legacy_records');await runtime.runtimeImportBackupData({database:next});assert.equal((await db.query('SELECT count(*)::int AS count FROM community_legacy_records')).rows[0].count,2);
   const invalid=structuredClone(oldBackup);invalid.tables.courses.rowCount+=1;await assert.rejects(()=>runtime.runtimeImportBackupData({database:invalid}));assert.equal((await db.query('SELECT body FROM qna_posts WHERE id=9')).rows[0].body,'Keep this post');
   await migratePlatform(getConfig());assert.equal((await db.query('SELECT count(*)::int AS count FROM community_legacy_records')).rows[0].count,2);
  });
 }finally{await runtime?.runtimeCloseDatabasePool();await db.end();}
});

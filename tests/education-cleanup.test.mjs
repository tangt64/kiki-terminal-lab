import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {REMOVED_EDUCATION_TABLES,removeEmptyEducationTables,omitEmptyEducationSnapshots,removeLegacyEducationUserReferences} from '../platform/server/education-schema-cleanup.js';

test('removed education tables are not created by the new schema',()=>{
  const schema=fs.readFileSync(new URL('../platform/server/postgres-schema.sql',import.meta.url),'utf8');
  for(const table of REMOVED_EDUCATION_TABLES)assert.doesNotMatch(schema,new RegExp('CREATE TABLE IF NOT EXISTS '+table+'\\b'));
});
test('empty legacy education backup snapshots are omitted without changing general data',()=>{
  const users={rows:[{id:1,name:'Operator'}]};
  const old={users,certificates:{rows:[],rowCount:0},course_quotes:{chunks:[],rowCount:0}};
  assert.deepEqual(omitEmptyEducationSnapshots(old),{users});
  assert.equal(old.certificates.rows.length,0);
});
test('education backup data and invalid snapshots are never silently discarded',()=>{
  for(const value of [{rows:[{id:1}]},{rows:[],rowCount:1},{rows:[],chunks:[{rows:[{id:1}]}]},{rows:[],truncated:true},{},{rows:'invalid'}])assert.throws(()=>omitEmptyEducationSnapshots({certificates:value}));
  assert.deepEqual(omitEmptyEducationSnapshots({unrecognized:{rows:[]}}),{unrecognized:{rows:[]}});
});
test('education screen stubs and their application imports are removed',()=>{
  const app=fs.readFileSync(new URL('../platform/client/src/App.jsx',import.meta.url),'utf8');
  for(const name of ['course-view.jsx','learning-views.jsx','curriculum-2026-view.jsx','offline-schedule-view.jsx','survey-view.jsx','survey-results-view.jsx','course-quote-view.jsx']){
    assert.equal(fs.existsSync(new URL('../platform/client/src/'+name,import.meta.url)),false);
    assert.ok(!app.includes('import("./'+name+'")'));
  }
});

const url=process.env.TEST_EDUCATION_CLEANUP_DATABASE_URL;
test('independent empty education tables migrate safely while accounts, data and external references survive',{skip:!url},async t=>{
  assert.match(new URL(url).pathname,/^\/community_test_[a-z0-9_]+$/);
  const db=new pg.Client({connectionString:url});await db.connect();
  const transaction=async fn=>{await db.query('BEGIN');try{const value=await fn();await db.query('COMMIT');return value;}catch(error){await db.query('ROLLBACK');throw error;}};
  const create=async()=>{for(const name of REMOVED_EDUCATION_TABLES)await db.query('CREATE TABLE "'+name+'"(id integer PRIMARY KEY,user_id integer REFERENCES users(id))');};
  try{
    await db.query("CREATE TABLE users(id integer PRIMARY KEY,name text);INSERT INTO users VALUES(1,'preserved user')");
    await t.test('only empty education tables are removed and repeated runs are safe',async()=>{
      await create();const result=await transaction(()=>removeEmptyEducationTables(db));
      assert.equal(result.removed.length,7);assert.deepEqual(result.retained,[]);
      assert.equal((await db.query('SELECT name FROM users WHERE id=1')).rows[0].name,'preserved user');
      assert.deepEqual(await transaction(()=>removeEmptyEducationTables(db)),{removed:[],retained:[]});
    });
    await t.test('nonempty educational data preserves the entire group',async()=>{
      await create();await db.query('INSERT INTO certificates VALUES(1,1)');
      const result=await transaction(()=>removeEmptyEducationTables(db));assert.equal(result.removed.length,0);assert.equal(result.retained.length,7);
      assert.equal((await db.query('SELECT * FROM certificates')).rows.length,1);
      await transaction(()=>removeLegacyEducationUserReferences(db,1));
      assert.equal((await db.query('SELECT * FROM certificates')).rows.length,0);
      assert.equal((await db.query('SELECT * FROM users')).rows.length,1);
    });
    await t.test('unknown referencing tables are preserved rather than cascaded',async()=>{
      await db.query('CREATE TABLE operator_links(id integer REFERENCES schedule_events(id))');
      const result=await transaction(()=>removeEmptyEducationTables(db));assert.equal(result.removed.length,0);assert.equal(result.retained.length,7);
      assert.ok((await db.query("SELECT to_regclass('operator_links') AS name")).rows[0].name);
      await db.query('DROP TABLE operator_links');
      assert.equal((await transaction(()=>removeEmptyEducationTables(db))).removed.length,7);
    });
    await t.test('caller rollback restores removed tables',async()=>{
      await create();await db.query('BEGIN');await removeEmptyEducationTables(db);await db.query('ROLLBACK');
      assert.ok((await db.query("SELECT to_regclass('certificates') AS name")).rows[0].name);
    });
  }finally{await db.end();}
});

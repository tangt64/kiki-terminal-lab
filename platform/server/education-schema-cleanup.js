// Retired names are retained only to migrate installed databases and backups.
export const REMOVED_EDUCATION_TABLES = Object.freeze([
  'courses','textbooks','course_textbooks','schedule_events','user_course_access',
  'course_access_requests','payments','exam_entitlements','course_package_grants',
  'course_quotes','course_quote_items','lab_requests','lab_exam_sessions','lab_exam_configs',
  'written_exam_attempts','lab_exam_attempts','course_survey_responses','certificates',
  'arena_seasons','arena_scenarios','arena_nodes','arena_sessions','arena_attempts','arena_captures','arena_events',
]);
const allowedLinks = new Set([
  'qna_posts.course_id','qna_posts.lab_request_id','invite_codes.course_id',
  'cicd_projects.course_id','cicd_projects.lab_request_id','discount_coupons.course_id','lucky_draw_rewards.course_id',
]);
export const LEGACY_ARCHIVE_SCHEMA = `CREATE TABLE IF NOT EXISTS public.community_legacy_records (
  source_table TEXT NOT NULL, row_index BIGINT NOT NULL, row_data JSONB NOT NULL,
  PRIMARY KEY(source_table,row_index)
)`;
const quote = name => '"' + name.replaceAll('"','""') + '"';

// Called inside the installation transaction, after the Community DB guard.
// The old rows are copied verbatim to a generic archive before removing tables.
export async function archiveEducationTables(client) {
  await client.query(LEGACY_ARCHIVE_SCHEMA);
  const {rows} = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [REMOVED_EDUCATION_TABLES]);
  const names = rows.map(row=>row.tablename);
  if (!names.length) return {removed:[],archivedRows:0};
  const identifiers = names.map(name=>'public.'+quote(name)).join(', ');
  await client.query('LOCK TABLE '+identifiers+' IN ACCESS EXCLUSIVE MODE');
  const links = await client.query(`SELECT con.conname,ns.nspname,src.relname,
      ARRAY(SELECT att.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum,ord)
        JOIN pg_attribute att ON att.attrelid=src.oid AND att.attnum=key.attnum ORDER BY key.ord) AS columns
    FROM pg_constraint con JOIN pg_class target ON target.oid=con.confrelid
    JOIN pg_namespace targetns ON targetns.oid=target.relnamespace
    JOIN pg_class src ON src.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace
    WHERE con.contype='f' AND targetns.nspname='public' AND target.relname=ANY($1::text[])
      AND NOT(ns.nspname='public' AND src.relname=ANY($1::text[]))`, [names]);
  for (const link of links.rows) {
    if (link.nspname!=='public'||link.columns.length!==1||!allowedLinks.has(link.relname+'.'+link.columns[0])) {
      throw new Error('Education schema migration blocked by operator-managed reference: '+link.nspname+'.'+link.relname);
    }
  }
  let archivedRows=0;
  for (const name of names) {
    const occupied=await client.query('SELECT 1 FROM public.community_legacy_records WHERE source_table=$1 LIMIT 1',[name]);
    const present=await client.query('SELECT 1 FROM public.'+quote(name)+' LIMIT 1');
    if(occupied.rows.length&&present.rows.length)throw new Error('Existing archive conflicts with retired table: '+name);
    const saved=await client.query('INSERT INTO public.community_legacy_records(source_table,row_index,row_data) SELECT $1,row_number() OVER(ORDER BY ctid),to_jsonb(record) FROM public.'+quote(name)+' record',[name]);
    archivedRows+=saved.rowCount;
  }
  for(const link of links.rows)await client.query('ALTER TABLE public.'+quote(link.relname)+' DROP CONSTRAINT '+quote(link.conname));
  // No CASCADE. Optional link columns and all general rows remain intact.
  await client.query('DROP TABLE '+identifiers);
  return {removed:names,archivedRows};
}

function snapshotRows(snapshot,name){
  if(!snapshot||typeof snapshot!=='object'||snapshot.truncated)throw new Error('Incomplete legacy backup table: '+name);
  if(snapshot.format&&snapshot.format!=='json-row-chunks-v1')throw new Error('Unsupported legacy backup format: '+name);
  const chunks=Array.isArray(snapshot.chunks)?snapshot.chunks:[{rows:snapshot.rows,rowCount:snapshot.rowCount}];
  const result=[];
  for(const chunk of chunks){
    if(!Array.isArray(chunk?.rows)||chunk.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Invalid legacy backup rows: '+name);
    if(chunk.rowCount!==undefined&&Number(chunk.rowCount)!==chunk.rows.length)throw new Error('Incomplete legacy backup chunk: '+name);
    result.push(...chunk.rows);
  }
  if(snapshot.rowCount!==undefined&&Number(snapshot.rowCount)!==result.length)throw new Error('Incomplete legacy backup table: '+name);
  return result;
}

// Adapt old backup data before any general table is truncated. Retired records
// become ordinary archive rows and are included in subsequent exports.
export function separateLegacyBackup(database){
  if(!database||!database.tables||typeof database.tables!=='object'||Array.isArray(database.tables)||
      (database.dumps!==undefined&&(!database.dumps||typeof database.dumps!=='object'||Array.isArray(database.dumps))))throw new Error('Invalid database backup');
  const tables={...database.tables},dumps={...(database.dumps||{})};
  const archive=[...snapshotRows(tables.community_legacy_records||{rows:[]},'community_legacy_records')];
  if(dumps.community_legacy_records)throw new Error('Duplicate archive snapshot source');
  for(const name of REMOVED_EDUCATION_TABLES){
    if(!(name in tables)&&!(name in dumps))continue;
    const fromTable=name in tables?snapshotRows(tables[name],name):null;
    const fromDump=name in dumps?snapshotRows(dumps[name],name):null;
    if(fromTable?.length&&fromDump)throw new Error('Duplicate legacy snapshot source: '+name);
    const records=fromDump||fromTable||[];
    if(records.length&&archive.some(row=>row.source_table===name))throw new Error('Conflicting legacy archive: '+name);
    records.forEach((row,index)=>archive.push({source_table:name,row_index:index+1,row_data:row}));
    delete tables[name];delete dumps[name];
  }
  tables.community_legacy_records={rows:archive,rowCount:archive.length};
  return {tables,dumps};
}

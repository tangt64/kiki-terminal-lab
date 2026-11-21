// These tables have no callers in the Community general/user/admin runtime.
// Shared course/lab tables are deliberately excluded from this migration.
export const REMOVED_EDUCATION_TABLES = Object.freeze([
  'schedule_events', 'course_survey_responses', 'written_exam_attempts',
  'lab_exam_attempts', 'certificates', 'course_quotes', 'course_quote_items',
]);

// Preserve the former account-deletion contract if an installation retained
// populated legacy tables. The new schema does not create these tables.
export async function removeLegacyEducationUserReferences(client, userId) {
  const legacy = ['written_exam_attempts', 'lab_exam_attempts', 'certificates'];
  const {rows} = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [legacy]);
  for (const {tablename} of rows) {
    await client.query('DELETE FROM "public"."' + tablename + '" WHERE user_id=$1', [userId]);
  }
}

export async function removeEmptyEducationTables(client) {
  const {rows} = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
    [REMOVED_EDUCATION_TABLES],
  );
  const names = rows.map(row => row.tablename);
  if (!names.length) return {removed: [], retained: []};
  const identifiers = names.map(name => '"public"."' + name + '"').join(', ');
  // The caller holds a transaction. Lock before checking contents to avoid a
  // write racing the empty-table check. DROP never uses CASCADE.
  await client.query('LOCK TABLE ' + identifiers + ' IN ACCESS EXCLUSIVE MODE');
  for (const name of names) {
    const result = await client.query('SELECT 1 FROM "public"."' + name + '" LIMIT 1');
    if (result.rows.length) return {removed: [], retained: names};
  }
  const externalReferences = await client.query(`
    SELECT 1 FROM pg_constraint con
    JOIN pg_class target ON target.oid=con.confrelid
    JOIN pg_namespace ns ON ns.oid=target.relnamespace
    WHERE con.contype='f' AND ns.nspname='public'
      AND target.relname=ANY($1::text[])
      AND con.conrelid<>ALL(SELECT oid FROM pg_class WHERE relnamespace=ns.oid AND relname=ANY($1::text[]))
    LIMIT 1`, [names]);
  if (externalReferences.rows.length) return {removed: [], retained: names};
  await client.query('DROP TABLE ' + identifiers);
  return {removed: names, retained: []};
}

// Older backups include snapshots of the empty compatibility tables. Accept
// only provably empty snapshots, and never silently discard educational data.
export function omitEmptyEducationSnapshots(snapshots) {
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) return snapshots;
  return Object.fromEntries(Object.entries(snapshots).filter(([name, snapshot]) => {
    if (!REMOVED_EDUCATION_TABLES.includes(name)) return true;
    const rows = snapshot?.rows;
    const chunks = snapshot?.chunks;
    const validRows = Array.isArray(rows) && rows.length === 0;
    const validChunks = Array.isArray(chunks) && chunks.every(chunk =>
      Array.isArray(chunk?.rows) && chunk.rows.length === 0 && Number(chunk.rowCount || 0) === 0);
    if ((!validRows && !validChunks) || Number(snapshot?.rowCount || 0) !== 0 ||
        (rows !== undefined && !validRows) || (chunks !== undefined && !validChunks) || snapshot?.truncated) {
      throw new Error('Cannot discard nonempty or invalid education backup table: ' + name);
    }
    return false;
  }));
}

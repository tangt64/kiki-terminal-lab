import pg from "pg";

const { Client } = pg;

const REQUIRED_TABLES = [
  "users",
  "platform_settings",
  "courses",
  "exam_entitlements",
  "course_package_grants",
  "lab_requests",
  "terminal_replay_sessions",
  "terminal_replay_events",
  "custom_lab_requests",
  "self_service_vms",
  "zun_containers",
  "invite_codes",
  "notices",
  "qna_posts",
  "qna_comments",
  "sessions",
];

export async function probePostgresStatus({ enabled = true, connectionString = "" } = {}) {
  const trimmed = String(connectionString || "").trim();
  if (!enabled) {
    return {
      ok: false,
      endpoint: "-",
      message: "PostgreSQL 런타임이 아직 비활성화되어 있습니다.",
    };
  }

  if (!trimmed) {
    return {
      ok: false,
      endpoint: "-",
      message: "DATABASE_URL이 설정되지 않았습니다.",
    };
  }

  const client = new Client({
    connectionString: trimmed,
    connectionTimeoutMillis: 5000,
  });

  const startedAt = Date.now();
  try {
    await client.connect();
    const versionResult = await client.query("SELECT version() AS version");
    const tableResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));

    return {
      ok: missingTables.length === 0,
      endpoint: sanitizeDatabaseUrl(trimmed),
      latencyMs: Date.now() - startedAt,
      version: versionResult.rows[0]?.version || "",
      tableCount: existingTables.size,
      missingTables,
      message: missingTables.length ? `누락 테이블: ${missingTables.join(", ")}` : "PostgreSQL 준비 완료",
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: sanitizeDatabaseUrl(trimmed),
      latencyMs: Date.now() - startedAt,
      message: error.message,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function sanitizeDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const user = url.username ? encodeURIComponent(url.username) : "";
    const host = url.host || "-";
    const dbName = url.pathname?.replace(/^\//, "") || "-";
    return `${url.protocol}//${user ? `${user}@` : ""}${host}/${dbName}`;
  } catch {
    return value;
  }
}

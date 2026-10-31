import session from "express-session";
import pg from "pg";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const EXPIRED_CLEAR_INTERVAL_MS = 1000 * 60 * 5;
const DEFAULT_SESSION_TOUCH_INTERVAL_MS = 1000 * 60 * 5;
const { Pool } = pg;

export function createSessionStore(options = {}) {
  return createPostgresSessionStore(options);
}

function resolveExpiry(sess) {
  const cookieExpires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
  if (Number.isFinite(cookieExpires) && cookieExpires > 0) {
    return cookieExpires;
  }

  const maxAge = Number(sess?.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    return Date.now() + maxAge;
  }

  return Date.now() + DEFAULT_SESSION_TTL_MS;
}

export function createPostgresSessionStore({
  connectionString,
  maxConnections = process.env.SESSION_DATABASE_POOL_MAX_CONNECTIONS,
  touchIntervalMs = process.env.SESSION_TOUCH_INTERVAL_MS,
} = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  const resolvedMaxConnections = Math.max(1, Number(maxConnections || 5) || 5);
  const resolvedTouchIntervalMs = Math.max(
    0,
    Number(touchIntervalMs ?? DEFAULT_SESSION_TOUCH_INTERVAL_MS) || 0,
  );

  const pool = new Pool({
    connectionString,
    max: resolvedMaxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const store = new PostgresSessionStore(pool, {
    touchIntervalMs: resolvedTouchIntervalMs,
  });
  void store.initialize();
  return store;
}

class PostgresSessionStore extends session.Store {
  constructor(pool, { touchIntervalMs = DEFAULT_SESSION_TOUCH_INTERVAL_MS } = {}) {
    super();
    this.pool = pool;
    this.touchIntervalMs = Math.max(0, Number(touchIntervalMs || 0) || 0);
    this.lastTouchedAt = new Map();
    this.initPromise = null;
    this.expiredClearPromise = null;
    this.lastExpiredClearAt = 0;
  }

  initialize() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expires_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
          ON sessions (expires_at);
        `);
      })();
    }
    return this.initPromise;
  }

  async get(sid, callback) {
    try {
      await this.initialize();
      await this.clearExpiredIfNeeded();
      const result = await this.pool.query(
        `
          SELECT sess, expires_at AS "expiresAt", updated_at AS "updatedAt"
          FROM sessions
          WHERE sid = $1
        `,
        [sid],
      );
      const row = result.rows[0];
      if (!row) {
        callback?.(null, null);
        return;
      }

      if (Number(row.expiresAt) <= Date.now()) {
        await this.pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
        this.lastTouchedAt.delete(sid);
        callback?.(null, null);
        return;
      }

      this.lastTouchedAt.set(sid, Number(row.updatedAt || 0) || Date.now());
      callback?.(null, JSON.parse(row.sess));
    } catch (error) {
      callback?.(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      await this.initialize();
      await this.clearExpiredIfNeeded();
      const expiresAt = resolveExpiry(sess);
      await this.pool.query(
        `
          INSERT INTO sessions (sid, sess, expires_at, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (sid) DO UPDATE SET
            sess = EXCLUDED.sess,
            expires_at = EXCLUDED.expires_at,
            updated_at = EXCLUDED.updated_at
        `,
        [sid, JSON.stringify(sess), expiresAt, Date.now()],
      );
      this.lastTouchedAt.set(sid, Date.now());
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.initialize();
      await this.pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
      this.lastTouchedAt.delete(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sid, sess, callback) {
    const now = Date.now();
    const lastTouchedAt = Number(this.lastTouchedAt.get(sid) || 0);
    if (this.touchIntervalMs > 0 && lastTouchedAt > 0 && now - lastTouchedAt < this.touchIntervalMs) {
      callback?.(null);
      return;
    }
    this.lastTouchedAt.set(sid, now);
    try {
      await this.initialize();
      await this.clearExpiredIfNeeded();
      await this.pool.query(
        `
          UPDATE sessions
          SET sess = $2, expires_at = $3, updated_at = $4
          WHERE sid = $1
        `,
        [sid, JSON.stringify(sess), resolveExpiry(sess), now],
      );
      callback?.(null);
    } catch (error) {
      this.lastTouchedAt.delete(sid);
      callback?.(error);
    }
  }

  async clearExpired() {
    await this.initialize();
    const now = Date.now();
    await this.pool.query(`DELETE FROM sessions WHERE expires_at <= $1`, [now]);
    const staleTouchCutoff = now - DEFAULT_SESSION_TTL_MS;
    for (const [sid, touchedAt] of this.lastTouchedAt.entries()) {
      if (Number(touchedAt || 0) <= staleTouchCutoff) {
        this.lastTouchedAt.delete(sid);
      }
    }
  }

  async clearExpiredIfNeeded() {
    const now = Date.now();
    if (now - this.lastExpiredClearAt < EXPIRED_CLEAR_INTERVAL_MS) {
      return;
    }
    if (this.expiredClearPromise) {
      await this.expiredClearPromise;
      return;
    }
    this.expiredClearPromise = this.clearExpired()
      .then(() => {
        this.lastExpiredClearAt = Date.now();
      })
      .finally(() => {
        this.expiredClearPromise = null;
      });
    await this.expiredClearPromise;
  }
}

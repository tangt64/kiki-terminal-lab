-- Standalone community schema. No courses, enrollments, education labs or payments.
CREATE TABLE IF NOT EXISTS community_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','disabled')),
  self_service_vm_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS project_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  project_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','provisioning','approved','rejected','failed','deleting','deleted')),
  config JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS active_project_owner ON project_requests(user_id) WHERE status NOT IN ('rejected','deleted');
CREATE UNIQUE INDEX IF NOT EXISTS active_project_name ON project_requests(project_name) WHERE status NOT IN ('rejected','deleted');
CREATE TABLE IF NOT EXISTS cloud_actions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  project_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  request JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','executing','completed','rejected','failed')),
  result JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cloud_actions_owner ON cloud_actions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id=1), value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO community_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public_routes (
  id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),project_name TEXT NOT NULL,
  server_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ssh','tcp','http')),target_host TEXT NOT NULL,target_port INTEGER NOT NULL,
  external_port INTEGER UNIQUE,subdomain TEXT UNIQUE,protocol TEXT NOT NULL DEFAULT 'http',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

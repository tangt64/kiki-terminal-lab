CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  signup_reason TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student',
  status TEXT NOT NULL DEFAULT 'pending',
  user_source TEXT NOT NULL DEFAULT 'self_signup',
  approval_mail_sent_at TEXT,
  otp_enabled INTEGER NOT NULL DEFAULT 0,
  otp_secret TEXT NOT NULL DEFAULT '',
  support_message_enabled INTEGER NOT NULL DEFAULT 0,
  self_service_vm_enabled INTEGER NOT NULL DEFAULT 0,
  poc_free_access_enabled INTEGER NOT NULL DEFAULT 0,
  instructor_share_enabled INTEGER NOT NULL DEFAULT 0,
  admin_permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS password_reset_pins (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  pin_hash TEXT NOT NULL,
  issued_by BIGINT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_access_logs (
  id BIGINT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  user_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_access_logs_user_created ON user_access_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_access_logs_event_created ON user_access_logs(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT PRIMARY KEY,
  admin_user_id BIGINT REFERENCES users(id),
  admin_username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created ON admin_audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created ON admin_audit_logs(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS openstack_resource_usage_snapshots (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL DEFAULT '',
  driver TEXT NOT NULL DEFAULT '',
  resource_key TEXT NOT NULL,
  resource_label TEXT NOT NULL DEFAULT '',
  used_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  limit_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  percent INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openstack_usage_project_resource_collected ON openstack_resource_usage_snapshots(project_name, resource_key, collected_at DESC);

CREATE TABLE IF NOT EXISTS terminal_replay_sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lab_request_id BIGINT,
  course_id BIGINT,
  node_id TEXT NOT NULL DEFAULT '',
  node_name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  target_label TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recording',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS terminal_replay_events (
  id BIGINT PRIMARY KEY,
  replay_session_id TEXT NOT NULL REFERENCES terminal_replay_sessions(id) ON DELETE CASCADE,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_session_devices (
  session_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL DEFAULT '',
  ip_prefix TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  warned_at TEXT,
  restricted_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_user_session_devices_user_last_seen ON user_session_devices(user_id, last_seen_at);

CREATE TABLE IF NOT EXISTS user_access_restrictions (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  restricted_until TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_access_restrictions_user_until ON user_access_restrictions(user_id, restricted_until);

CREATE TABLE IF NOT EXISTS user_marketing_consents (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  purpose TEXT NOT NULL DEFAULT 'marketing',
  consented INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  agreed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_marketing_consents_user_created ON user_marketing_consents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  link_section TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS user_messages (
  id BIGINT PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id),
  recipient_id BIGINT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT,
  sender_archived INTEGER NOT NULL DEFAULT 0,
  recipient_archived INTEGER NOT NULL DEFAULT 0,
  recipient_type TEXT NOT NULL DEFAULT 'user',
  recipient_group_key TEXT NOT NULL DEFAULT '',
  recipient_group_name TEXT NOT NULL DEFAULT '',
  delivery_group_id TEXT NOT NULL DEFAULT '',
  cleanup_status TEXT NOT NULL DEFAULT '',
  cleanup_status_note TEXT NOT NULL DEFAULT '',
  cleanup_status_updated_at TEXT,
  cleanup_status_updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_created ON user_messages(recipient_id, recipient_archived, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_sender_created ON user_messages(sender_id, sender_archived, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS mail_logs (
  id TEXT PRIMARY KEY,
  mail_type TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  sender_username TEXT NOT NULL DEFAULT '',
  recipient_mode TEXT NOT NULL DEFAULT 'manual',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  recipients_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'operational',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  recipient_modes_json TEXT NOT NULL DEFAULT '[]',
  source_file_name TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  total_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  no_reply_count INTEGER NOT NULL DEFAULT 0,
  reply_deadline_at TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS mail_campaign_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  sources_json TEXT NOT NULL DEFAULT '[]',
  company_name TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  accepted_at TEXT,
  bounced_at TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_mail_campaigns_created ON mail_campaigns(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mail_campaigns_status_created ON mail_campaigns(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_campaign_status ON mail_campaign_deliveries(campaign_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_message ON mail_campaign_deliveries(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_email ON mail_campaign_deliveries(email, created_at DESC);

CREATE TABLE IF NOT EXISTS courses (
  id BIGINT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  course_type TEXT NOT NULL DEFAULT 'standard',
  package_items_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  promo_enabled INTEGER NOT NULL DEFAULT 0,
  promo_price INTEGER NOT NULL DEFAULT 0,
  promo_starts_at TEXT NOT NULL DEFAULT '',
  promo_ends_at TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL,
  course_access_days INTEGER NOT NULL DEFAULT 30,
  level TEXT NOT NULL,
  body TEXT NOT NULL,
  youtube_url TEXT NOT NULL DEFAULT '',
  online_meeting_url TEXT NOT NULL DEFAULT '',
  online_board_url TEXT NOT NULL DEFAULT '',
  online_course_notice TEXT NOT NULL DEFAULT '',
  online_session_note TEXT NOT NULL DEFAULT '',
  lab_guide_markdown TEXT NOT NULL DEFAULT '',
  commands_markdown TEXT NOT NULL DEFAULT '',
  ai_system_prompt TEXT NOT NULL DEFAULT '',
  ai_quick_prompts_json TEXT NOT NULL DEFAULT '[]',
  objectives_json TEXT NOT NULL,
  materials_json TEXT NOT NULL,
  course_curriculum_json TEXT NOT NULL DEFAULT '[]',
  course_videos_json TEXT NOT NULL DEFAULT '[]',
  course_recordings_json TEXT NOT NULL DEFAULT '[]',
  external_tool_links_json TEXT NOT NULL DEFAULT '[]',
  external_learning_tools_json TEXT NOT NULL DEFAULT '[]',
  lab_start_checklist_json TEXT NOT NULL DEFAULT '[]',
  lab_enabled INTEGER NOT NULL DEFAULT 0,
  lab_approval_mode TEXT NOT NULL DEFAULT 'manual',
  public_domain_approval_mode TEXT NOT NULL DEFAULT 'manual',
  public_tcp_approval_mode TEXT NOT NULL DEFAULT 'manual',
  external_ssh_approval_mode TEXT NOT NULL DEFAULT 'manual',
  external_rdp_approval_mode TEXT NOT NULL DEFAULT 'manual',
  lab_retention_mode TEXT NOT NULL DEFAULT 'ephemeral',
  lab_retention_preset TEXT NOT NULL DEFAULT '1',
  lab_retention_days INTEGER NOT NULL DEFAULT 1,
  allow_resume_existing_lab INTEGER NOT NULL DEFAULT 0,
  lab_resize_policy TEXT NOT NULL DEFAULT 'requestable',
  lab_resize_allowed_flavors TEXT NOT NULL DEFAULT '',
  terminal_replay_mode TEXT NOT NULL DEFAULT 'inherit',
  traffic_monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  traffic_daily_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
  traffic_total_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
  traffic_exceeded_action TEXT NOT NULL DEFAULT 'warn',
  heat_api_url TEXT NOT NULL DEFAULT '',
  heat_template_name TEXT NOT NULL DEFAULT '',
  heat_stack_prefix TEXT NOT NULL DEFAULT '',
  heat_parameters_json TEXT NOT NULL DEFAULT '{}',
  terminal_ssh_user TEXT NOT NULL DEFAULT 'ubuntu',
  terminal_ssh_port INTEGER NOT NULL DEFAULT 22,
  terminal_jump_host TEXT NOT NULL DEFAULT '',
  terminal_jump_user TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 1,
  is_landing_preview INTEGER NOT NULL DEFAULT 0,
  course_status TEXT NOT NULL DEFAULT 'published',
  release_label TEXT NOT NULL DEFAULT '',
  access_scope TEXT NOT NULL DEFAULT 'public',
  access_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS textbooks (
  id BIGINT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version TEXT NOT NULL DEFAULT '1.0',
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_textbooks (
  id BIGINT PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  textbook_id BIGINT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(course_id, textbook_id)
);

CREATE INDEX IF NOT EXISTS idx_course_textbooks_course_order ON course_textbooks(course_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_course_textbooks_textbook ON course_textbooks(textbook_id);

CREATE TABLE IF NOT EXISTS qna_posts (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT REFERENCES courses(id),
  lab_request_id BIGINT,
  post_type TEXT NOT NULL DEFAULT 'question',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  answer_text TEXT,
  answered_by BIGINT REFERENCES users(id),
  accepted_comment_id BIGINT,
  lab_context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS qna_comments (
  id BIGINT PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES qna_posts(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  parent_comment_id BIGINT REFERENCES qna_comments(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qna_helpful_votes (
  post_id BIGINT NOT NULL REFERENCES qna_posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_qna_posts_type_status ON qna_posts(post_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qna_posts_course_lab ON qna_posts(course_id, lab_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qna_helpful_votes_post ON qna_helpful_votes(post_id);

CREATE TABLE IF NOT EXISTS schedule_events (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  instructor_name TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  apply_url TEXT NOT NULL DEFAULT '',
  apply_method TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'scheduled',
  show_on_landing INTEGER NOT NULL DEFAULT 0,
  promotion_enabled INTEGER NOT NULL DEFAULT 0,
  promotion_title TEXT NOT NULL DEFAULT '',
  promotion_message TEXT NOT NULL DEFAULT '',
  promotion_priority INTEGER NOT NULL DEFAULT 0,
  badge_label TEXT NOT NULL DEFAULT '',
  icon_key TEXT NOT NULL DEFAULT 'video',
  course_id BIGINT REFERENCES courses(id),
  recurrence_json TEXT NOT NULL DEFAULT '{}',
  recurrence_exceptions_json TEXT NOT NULL DEFAULT '[]',
  schedule_source TEXT NOT NULL DEFAULT 'manual',
  external_event_id TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_start ON schedule_events(start_at);
CREATE INDEX IF NOT EXISTS idx_schedule_events_course ON schedule_events(course_id);
CREATE INDEX IF NOT EXISTS idx_schedule_events_visibility ON schedule_events(visibility);
CREATE INDEX IF NOT EXISTS idx_schedule_events_status ON schedule_events(status);
CREATE INDEX IF NOT EXISTS idx_schedule_events_external_source ON schedule_events(schedule_source, external_event_id);

CREATE TABLE IF NOT EXISTS consulting_requests (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  title TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  inquiry_type TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  current_environment TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  budget_range TEXT NOT NULL DEFAULT '',
  desired_timeline TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS public_quote_inquiries (
  id BIGINT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'requested',
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  interest_type TEXT NOT NULL DEFAULT '',
  course_titles TEXT NOT NULL DEFAULT '',
  participant_count INTEGER NOT NULL DEFAULT 1,
  desired_timeline TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  privacy_agreed INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_status_created ON public_quote_inquiries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_email_created ON public_quote_inquiries(contact_email, created_at DESC);

CREATE TABLE IF NOT EXISTS notices (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_daily_usage (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_question_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id BIGINT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  course_id BIGINT REFERENCES courses(id),
  expires_at TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_course_access (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  granted_via TEXT NOT NULL DEFAULT 'code',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS course_access_requests (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  status TEXT NOT NULL DEFAULT 'requested',
  request_type TEXT NOT NULL DEFAULT 'access',
  request_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by BIGINT REFERENCES users(id),
  review_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  provider TEXT NOT NULL DEFAULT 'manual',
  order_id TEXT NOT NULL UNIQUE,
  payment_key TEXT UNIQUE,
  provider_order_id TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KRW',
  status TEXT NOT NULL DEFAULT 'ready',
  failure_reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  requested_at TEXT NOT NULL,
  ready_at TEXT,
  paid_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  reviewed_by BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_entitlements (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'admin',
  source_payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  required_course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_exam_entitlements_user_exam_status ON exam_entitlements(user_id, exam_course_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_entitlements_payment ON exam_entitlements(source_payment_id);

CREATE TABLE IF NOT EXISTS course_package_grants (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  item_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  access_created INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, package_course_id, item_course_id, source_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_course_package_grants_payment ON course_package_grants(source_payment_id, status);
CREATE INDEX IF NOT EXISTS idx_course_package_grants_user ON course_package_grants(user_id, package_course_id, status);

CREATE TABLE IF NOT EXISTS course_quotes (
  id BIGINT PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'issued',
  recipient_company_name TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  subtotal_amount INTEGER NOT NULL DEFAULT 0,
  discount_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  vat_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KRW',
  pricing_basis_json TEXT NOT NULL DEFAULT '{}',
  business_snapshot_json TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  issued_at TEXT NOT NULL,
  valid_until TEXT,
  sent_at TEXT,
  sent_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_quotes_user_issued ON course_quotes(user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_quotes_status_issued ON course_quotes(status, issued_at DESC);

CREATE TABLE IF NOT EXISTS course_quote_items (
  id BIGINT PRIMARY KEY,
  quote_id BIGINT NOT NULL REFERENCES course_quotes(id) ON DELETE CASCADE,
  course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  course_title TEXT NOT NULL DEFAULT '',
  course_slug TEXT NOT NULL DEFAULT '',
  course_category TEXT NOT NULL DEFAULT '',
  course_type TEXT NOT NULL DEFAULT 'standard',
  program_type TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  line_subtotal INTEGER NOT NULL DEFAULT 0,
  pricing_note TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_quote_items_quote ON course_quote_items(quote_id, sort_order, id);

CREATE TABLE IF NOT EXISTS discount_coupons (
  id BIGINT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT REFERENCES courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_discount_coupons_user_status ON discount_coupons(user_id, status);

CREATE TABLE IF NOT EXISTS terms_versions (
  id BIGINT PRIMARY KEY,
  terms_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(terms_key, version)
);

CREATE INDEX IF NOT EXISTS idx_terms_versions_key_active ON terms_versions(terms_key, is_active);

CREATE TABLE IF NOT EXISTS user_terms_agreements (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version_id BIGINT NOT NULL REFERENCES terms_versions(id),
  terms_key TEXT NOT NULL,
  terms_title TEXT NOT NULL DEFAULT '',
  terms_version TEXT NOT NULL,
  terms_summary TEXT NOT NULL DEFAULT '',
  terms_body TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  agreed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_terms_agreements_user ON user_terms_agreements(user_id, agreed_at DESC);

CREATE TABLE IF NOT EXISTS lab_requests (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  status TEXT NOT NULL DEFAULT 'pending',
  approval_mode TEXT NOT NULL DEFAULT 'manual',
  stack_name TEXT,
  stack_id TEXT,
  instance_uuid TEXT,
  instance_ip TEXT,
  current_flavor TEXT NOT NULL DEFAULT '',
  instance_ips_json TEXT NOT NULL DEFAULT '[]',
  vm_nodes_json TEXT NOT NULL DEFAULT '[]',
  terminal_ssh_user TEXT NOT NULL DEFAULT '',
  terminal_ssh_password TEXT NOT NULL DEFAULT '',
  traffic_resource_id TEXT NOT NULL DEFAULT '',
  traffic_incoming_metric_id TEXT NOT NULL DEFAULT '',
  traffic_outgoing_metric_id TEXT NOT NULL DEFAULT '',
  traffic_rx_bytes BIGINT NOT NULL DEFAULT 0,
  traffic_tx_bytes BIGINT NOT NULL DEFAULT 0,
  traffic_total_bytes BIGINT NOT NULL DEFAULT 0,
  traffic_daily_bytes BIGINT NOT NULL DEFAULT 0,
  traffic_checked_at TEXT,
  traffic_exceeded INTEGER NOT NULL DEFAULT 0,
  traffic_exceeded_at TEXT,
  cpu_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  memory_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  disk_read_bytes BIGINT NOT NULL DEFAULT 0,
  disk_write_bytes BIGINT NOT NULL DEFAULT 0,
  vm_metrics_checked_at TEXT,
  requested_public_domains_json TEXT NOT NULL DEFAULT '[]',
  requested_public_subdomain TEXT NOT NULL DEFAULT '',
  requested_public_fqdn TEXT NOT NULL DEFAULT '',
  requested_public_protocol TEXT NOT NULL DEFAULT 'http',
  requested_public_port INTEGER,
  public_domains_json TEXT NOT NULL DEFAULT '[]',
  public_subdomain TEXT NOT NULL DEFAULT '',
  public_fqdn TEXT NOT NULL DEFAULT '',
  public_protocol TEXT NOT NULL DEFAULT 'http',
  public_port INTEGER,
  public_enabled INTEGER NOT NULL DEFAULT 0,
  public_request_pending INTEGER NOT NULL DEFAULT 0,
  public_reviewed_by TEXT NOT NULL DEFAULT '',
  public_reviewed_at TEXT,
  public_review_note TEXT NOT NULL DEFAULT '',
  requested_public_tcp_routes_json TEXT NOT NULL DEFAULT '[]',
  public_tcp_routes_json TEXT NOT NULL DEFAULT '[]',
  public_tcp_enabled INTEGER NOT NULL DEFAULT 0,
  public_tcp_request_pending INTEGER NOT NULL DEFAULT 0,
  public_tcp_reviewed_by TEXT NOT NULL DEFAULT '',
  public_tcp_reviewed_at TEXT,
  public_tcp_review_note TEXT NOT NULL DEFAULT '',
  external_ssh_enabled INTEGER NOT NULL DEFAULT 0,
  external_ssh_port INTEGER,
  external_ssh_request_pending INTEGER NOT NULL DEFAULT 0,
  external_ssh_reviewed_by TEXT NOT NULL DEFAULT '',
  external_ssh_reviewed_at TEXT,
  external_ssh_review_note TEXT NOT NULL DEFAULT '',
  external_rdp_enabled INTEGER NOT NULL DEFAULT 0,
  external_rdp_port INTEGER,
  external_rdp_request_pending INTEGER NOT NULL DEFAULT 0,
  external_rdp_reviewed_by TEXT NOT NULL DEFAULT '',
  external_rdp_reviewed_at TEXT,
  external_rdp_review_note TEXT NOT NULL DEFAULT '',
  requested_resize_flavor TEXT NOT NULL DEFAULT '',
  resize_request_pending INTEGER NOT NULL DEFAULT 0,
  resize_reviewed_by TEXT NOT NULL DEFAULT '',
  resize_reviewed_at TEXT,
  resize_review_note TEXT NOT NULL DEFAULT '',
  metallb_vip_cidr TEXT NOT NULL DEFAULT '',
  last_accessed_at TEXT,
  expires_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  started_at TEXT,
  terminated_at TEXT
);

CREATE TABLE IF NOT EXISTS cicd_projects (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  lab_request_id BIGINT REFERENCES lab_requests(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'manual',
  repository_url TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  pipeline_engine TEXT NOT NULL DEFAULT 'jenkins',
  jenkins_job_name TEXT NOT NULL DEFAULT '',
  jenkinsfile_path TEXT NOT NULL DEFAULT 'Jenkinsfile',
  build_server_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  variables_json TEXT NOT NULL DEFAULT '{}',
  stages_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_cicd_projects_user_status ON cicd_projects(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cicd_projects_course ON cicd_projects(course_id);

CREATE TABLE IF NOT EXISTS cicd_credentials (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  jenkins_credential_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_cicd_credentials_user_updated ON cicd_credentials(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cicd_runs (
  id BIGINT PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES cicd_projects(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  commit_ref TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '',
  source_branch TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  current_stage TEXT NOT NULL DEFAULT '',
  jenkins_build_number TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cicd_runs_project_created ON cicd_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cicd_runs_user_created ON cicd_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cicd_runs_status_created ON cicd_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS cicd_run_events (
  id BIGINT PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES cicd_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cicd_run_events_run_created ON cicd_run_events(run_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS heat_workload_test_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'queued',
  message TEXT NOT NULL DEFAULT '',
  template_name TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  stack_name TEXT NOT NULL DEFAULT '',
  stack_id TEXT NOT NULL DEFAULT '',
  stack_count INTEGER NOT NULL DEFAULT 1,
  created_stack_count INTEGER NOT NULL DEFAULT 0,
  ready_stack_count INTEGER NOT NULL DEFAULT 0,
  failed_stack_count INTEGER NOT NULL DEFAULT 0,
  pending_stack_count INTEGER NOT NULL DEFAULT 0,
  hold_seconds INTEGER NOT NULL DEFAULT 0,
  cleanup_due_at TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  stack_status_summary_json TEXT NOT NULL DEFAULT '{}',
  host_usage_report_json TEXT NOT NULL DEFAULT '{}',
  stacks_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_status_updated ON heat_workload_test_jobs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_project_updated ON heat_workload_test_jobs(project_name, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_template_updated ON heat_workload_test_jobs(template_name, updated_at DESC);

CREATE TABLE IF NOT EXISTS lab_exam_sessions (
  id TEXT PRIMARY KEY,
  course_id BIGINT NOT NULL,
  exam_title TEXT NOT NULL DEFAULT '',
  user_id BIGINT NOT NULL REFERENCES users(id),
  lab_request_id BIGINT,
  attempt_id TEXT,
  status TEXT NOT NULL DEFAULT 'preparing',
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  grading_started_at TEXT,
  grading_finished_at TEXT,
  end_reason TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_monitoring_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_access_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_starts_at TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_ends_at TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_meeting_url TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_board_url TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_course_notice TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_session_note TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS ai_quick_prompts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_curriculum_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_videos_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_recordings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_tool_links_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_learning_tools_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_start_checklist_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS survey_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS release_label TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_resize_policy TEXT NOT NULL DEFAULT 'requestable';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_resize_allowed_flavors TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS public_domain_approval_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS public_tcp_approval_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_daily_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_total_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_exceeded_action TEXT NOT NULL DEFAULT 'warn';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_title TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_message TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS badge_label TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS icon_key TEXT NOT NULL DEFAULT 'video';
ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_pinned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS instance_uuid TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS current_flavor TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_resource_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_incoming_metric_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_outgoing_metric_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_rx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_tx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_total_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_daily_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_checked_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_exceeded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_exceeded_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS cpu_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS memory_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS disk_read_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS disk_write_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS vm_metrics_checked_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS requested_public_tcp_routes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_routes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_request_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_reviewed_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'learning';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS exam_session_id TEXT;

CREATE TABLE IF NOT EXISTS custom_lab_requests (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  title TEXT NOT NULL,
  instance_count INTEGER NOT NULL DEFAULT 1,
  vcpu INTEGER NOT NULL,
  ram_gb INTEGER NOT NULL,
  disk_gb INTEGER NOT NULL,
  image_name TEXT NOT NULL,
  usage_period TEXT NOT NULL DEFAULT '',
  desired_budget INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  advanced_config_json TEXT NOT NULL DEFAULT '{}',
  cloud_init_template_name TEXT NOT NULL DEFAULT '',
  quoted_price TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  payment_provider TEXT NOT NULL DEFAULT '',
  payment_order_id TEXT NOT NULL DEFAULT '',
  payment_key TEXT NOT NULL DEFAULT '',
  payment_requested_at TEXT,
  payment_paid_at TEXT,
  payment_failed_at TEXT,
  payment_failure_reason TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  heat_template_name TEXT NOT NULL DEFAULT '',
  application_yaml_name TEXT NOT NULL DEFAULT '',
  stack_name TEXT,
  stack_id TEXT,
  instance_ip TEXT,
  instance_ips_json TEXT NOT NULL DEFAULT '[]',
  vm_nodes_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  started_at TEXT,
  terminated_at TEXT
);

ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS desired_budget INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_order_id TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_key TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_requested_at TEXT;
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_paid_at TEXT;
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_failed_at TEXT;
ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS self_service_vms (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  instance_count INTEGER NOT NULL DEFAULT 1,
  flavor TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT '',
  network_name TEXT NOT NULL DEFAULT 'net-infra',
  image_name TEXT NOT NULL DEFAULT '',
  cloud_init_template_name TEXT NOT NULL DEFAULT '',
  cloud_init_custom_content TEXT NOT NULL DEFAULT '',
  cloud_init_custom_file_name TEXT NOT NULL DEFAULT '',
  boot_from_volume INTEGER NOT NULL DEFAULT 0,
  boot_volume_size_gb INTEGER NOT NULL DEFAULT 20,
  boot_volume_type TEXT NOT NULL DEFAULT '',
  data_volume_enabled INTEGER NOT NULL DEFAULT 0,
  data_volume_count INTEGER NOT NULL DEFAULT 0,
  data_volume_size_gb INTEGER NOT NULL DEFAULT 0,
  data_volume_type TEXT NOT NULL DEFAULT '',
  floating_ip_requested INTEGER NOT NULL DEFAULT 0,
  public_access_note TEXT NOT NULL DEFAULT '',
  external_ssh_enabled INTEGER NOT NULL DEFAULT 0,
  external_ssh_port INTEGER,
  external_ssh_request_pending INTEGER NOT NULL DEFAULT 0,
  external_ssh_reviewed_by TEXT NOT NULL DEFAULT '',
  external_ssh_reviewed_at TEXT,
  external_ssh_review_note TEXT NOT NULL DEFAULT '',
  stack_name TEXT,
  stack_id TEXT,
  instance_ip TEXT,
  instance_ips_json TEXT NOT NULL DEFAULT '[]',
  vm_nodes_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  review_note TEXT,
  reviewed_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  started_at TEXT,
  terminated_at TEXT
);

ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_from_volume INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS network_name TEXT NOT NULL DEFAULT 'net-infra';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS image_name TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_template_name TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_custom_content TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_custom_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_volume_size_gb INTEGER NOT NULL DEFAULT 20;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_volume_type TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_size_gb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_type TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS floating_ip_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS public_access_note TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_port INTEGER;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_request_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_reviewed_at TEXT;
ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_review_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS self_service_project_requests (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_project_name TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  network_name TEXT NOT NULL DEFAULT '',
  subnet_cidr TEXT NOT NULL DEFAULT '',
  network_requests_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_user ON self_service_project_requests(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_project ON self_service_project_requests(project_name);
ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_name TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS subnet_cidr TEXT NOT NULL DEFAULT '';
ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_requests_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS quota_profile_id TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS requested_quota_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS zun_containers (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  project_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  image_name TEXT NOT NULL,
  command_text TEXT NOT NULL DEFAULT '',
  exposed_port INTEGER,
  container_uuid TEXT,
  registry_id TEXT NOT NULL DEFAULT '',
  registry_domain TEXT NOT NULL DEFAULT '',
  addresses_json TEXT NOT NULL DEFAULT '[]',
  public_domains_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS magnum_clusters (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  project_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  cluster_template_id TEXT NOT NULL,
  cluster_template_name TEXT NOT NULL DEFAULT '',
  kubernetes_version TEXT NOT NULL DEFAULT '',
  node_count INTEGER NOT NULL DEFAULT 1,
  master_count INTEGER NOT NULL DEFAULT 1,
  control_plane_flavor TEXT NOT NULL DEFAULT '',
  worker_flavor TEXT NOT NULL DEFAULT '',
  cluster_uuid TEXT,
  api_address TEXT NOT NULL DEFAULT '',
  status_reason TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS trove_instances (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested',
  project_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  datastore_type TEXT NOT NULL,
  datastore_version TEXT NOT NULL DEFAULT '',
  flavor TEXT NOT NULL,
  size_gb INTEGER NOT NULL DEFAULT 1,
  instance_uuid TEXT,
  hostname TEXT NOT NULL DEFAULT '',
  database_name TEXT NOT NULL DEFAULT '',
  database_username TEXT NOT NULL DEFAULT '',
  credential_secret_ref TEXT NOT NULL DEFAULT '',
  database_port INTEGER NOT NULL DEFAULT 3306,
  status_reason TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS resource_deletion_jobs (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  project_name TEXT NOT NULL DEFAULT '',
  resource_name TEXT NOT NULL DEFAULT '',
  remote_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_status_updated ON resource_deletion_jobs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_project_updated ON resource_deletion_jobs(project_name, updated_at DESC);

CREATE TABLE IF NOT EXISTS internal_image_cache (
  id BIGINT PRIMARY KEY,
  registry_url TEXT NOT NULL DEFAULT '',
  namespace TEXT NOT NULL DEFAULT '',
  repository TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT 'latest',
  image_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'harbor-cache',
  artifact_digest TEXT NOT NULL DEFAULT '',
  pushed_at TEXT NOT NULL DEFAULT '',
  cached_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(registry_url, namespace, repository, tag)
);

ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_id TEXT NOT NULL DEFAULT '';
ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS public_domains_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS control_plane_flavor TEXT NOT NULL DEFAULT '';
ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS worker_flavor TEXT NOT NULL DEFAULT '';
ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS kubernetes_version TEXT NOT NULL DEFAULT '';
ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_name TEXT NOT NULL DEFAULT '';
ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_username TEXT NOT NULL DEFAULT '';
ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS credential_secret_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_port INTEGER NOT NULL DEFAULT 3306;

CREATE TABLE IF NOT EXISTS written_exam_attempts (
  id TEXT PRIMARY KEY,
  course_id BIGINT NOT NULL,
  exam_title TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  username TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  score INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  results_json TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_exam_attempts (
  id TEXT PRIMARY KEY,
  course_id BIGINT NOT NULL,
  exam_title TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  username TEXT NOT NULL,
  session_id TEXT,
  lab_request_id BIGINT,
  exit_code INTEGER NOT NULL DEFAULT 1,
  stdout_text TEXT NOT NULL DEFAULT '',
  stderr_text TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    messages_json TEXT NOT NULL DEFAULT '[]',
    screenshot_path TEXT NOT NULL DEFAULT '',
    screenshot_url TEXT NOT NULL DEFAULT '',
    result_snapshot_json TEXT NOT NULL DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT NOT NULL DEFAULT '',
    reviewed_by BIGINT REFERENCES users(id),
    reviewed_at TEXT,
    review_history_json TEXT NOT NULL DEFAULT '[]',
    result_mail_sent_at TEXT,
    submitted_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS course_survey_responses (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  phase TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  llm_feedback_text TEXT NOT NULL DEFAULT '',
  llm_feedback_model TEXT NOT NULL DEFAULT '',
  llm_feedback_provider TEXT NOT NULL DEFAULT '',
  llm_feedback_message_id BIGINT,
  llm_feedback_delivered INTEGER NOT NULL DEFAULT 0,
  llm_feedback_generated_by BIGINT,
  llm_feedback_generated_at TEXT,
  UNIQUE(user_id, course_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_course_survey_responses_course_phase ON course_survey_responses(course_id, phase);
CREATE INDEX IF NOT EXISTS idx_course_survey_responses_user_course ON course_survey_responses(user_id, course_id);

CREATE TABLE IF NOT EXISTS marketing_surveys (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  multi_choice INTEGER NOT NULL DEFAULT 0,
  show_results INTEGER NOT NULL DEFAULT 1,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_survey_options (
  id BIGINT PRIMARY KEY,
  survey_id BIGINT NOT NULL REFERENCES marketing_surveys(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_survey_submissions (
  id BIGINT PRIMARY KEY,
  survey_id BIGINT NOT NULL REFERENCES marketing_surveys(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  survey_title TEXT NOT NULL DEFAULT '',
  survey_question TEXT NOT NULL DEFAULT '',
  option_labels_json TEXT NOT NULL DEFAULT '[]',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  UNIQUE(survey_id, user_id)
);

CREATE TABLE IF NOT EXISTS marketing_survey_submission_choices (
  id BIGINT PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES marketing_survey_submissions(id) ON DELETE CASCADE,
  option_id BIGINT NOT NULL REFERENCES marketing_survey_options(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(submission_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_surveys_status_window ON marketing_surveys(status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_marketing_survey_options_survey ON marketing_survey_options(survey_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_marketing_survey_submissions_survey ON marketing_survey_submissions(survey_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  username TEXT NOT NULL,
  course_id BIGINT NOT NULL,
  course_title TEXT NOT NULL,
  certificate_code TEXT NOT NULL UNIQUE,
  verify_code TEXT NOT NULL UNIQUE,
  written_attempt_id TEXT,
  lab_attempt_id TEXT,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_seasons (
  id BIGINT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  reset_policy TEXT NOT NULL DEFAULT 'quarterly',
  started_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_scenarios (
  id BIGINT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  backend_type TEXT NOT NULL DEFAULT 'container',
  console_type TEXT NOT NULL DEFAULT 'xterm',
  tier TEXT NOT NULL DEFAULT 'normal',
  difficulty INTEGER NOT NULL DEFAULT 1,
  ttl_seconds INTEGER NOT NULL DEFAULT 1200,
  validator_key TEXT NOT NULL DEFAULT '',
  image_name TEXT NOT NULL DEFAULT '',
  flavor_name TEXT NOT NULL DEFAULT '',
  network_name TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_nodes (
  id BIGINT PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
  scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),
  node_code TEXT NOT NULL,
  label TEXT NOT NULL,
  map_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  map_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  current_owner_user_id BIGINT REFERENCES users(id),
  current_owner_handle TEXT NOT NULL DEFAULT '',
  first_capture_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  UNIQUE(season_id, node_code)
);

CREATE TABLE IF NOT EXISTS arena_sessions (
  id BIGINT PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
  node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
  scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'provisioning',
  backend_type TEXT NOT NULL DEFAULT 'container',
  console_type TEXT NOT NULL DEFAULT 'xterm',
  resource_id TEXT NOT NULL DEFAULT '',
  resource_name TEXT NOT NULL DEFAULT '',
  console_url TEXT NOT NULL DEFAULT '',
  validator_state TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  terminated_reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS arena_attempts (
  id BIGINT PRIMARY KEY,
  session_id BIGINT NOT NULL UNIQUE REFERENCES arena_sessions(id) ON DELETE CASCADE,
  season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
  node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  result TEXT NOT NULL DEFAULT 'failed',
  score INTEGER NOT NULL DEFAULT 0,
  mmr_delta INTEGER NOT NULL DEFAULT 0,
  rank_delta INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  first_try_bonus INTEGER NOT NULL DEFAULT 0,
  remaining_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_captures (
  id BIGINT PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
  node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  capture_type TEXT NOT NULL DEFAULT 'first_blood',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_events (
  id BIGINT PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
  node_id BIGINT REFERENCES arena_nodes(id),
  user_id BIGINT REFERENCES users(id),
  event_type TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucky_draw_events (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  daily_attempt_limit INTEGER NOT NULL DEFAULT 3,
  require_verified_user INTEGER NOT NULL DEFAULT 1,
  allow_new_users_only INTEGER NOT NULL DEFAULT 0,
  new_user_window_days INTEGER NOT NULL DEFAULT 30,
  allow_dormant_users_only INTEGER NOT NULL DEFAULT 0,
  dormant_days INTEGER NOT NULL DEFAULT 30,
  created_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucky_draw_rewards (
  id BIGINT PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL DEFAULT 'message',
  label TEXT NOT NULL,
  course_id BIGINT REFERENCES courses(id),
  coupon_discount_type TEXT NOT NULL DEFAULT 'percent',
  coupon_discount_value INTEGER NOT NULL DEFAULT 0,
  coupon_expires_in_days INTEGER NOT NULL DEFAULT 7,
  probability_weight INTEGER NOT NULL DEFAULT 1,
  total_stock INTEGER,
  daily_stock INTEGER,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  message_text TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucky_draw_attempts (
  id BIGINT PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
  reward_id BIGINT REFERENCES lucky_draw_rewards(id) ON DELETE SET NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  attempt_date TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  result_status TEXT NOT NULL DEFAULT 'issued',
  grant_id BIGINT,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucky_draw_grants (
  id BIGINT PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
  reward_id BIGINT REFERENCES lucky_draw_rewards(id) ON DELETE SET NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  grant_type TEXT NOT NULL DEFAULT 'message',
  status TEXT NOT NULL DEFAULT 'issued',
  label TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lucky_draw_rewards_event_id ON lucky_draw_rewards(event_id);
CREATE INDEX IF NOT EXISTS idx_lucky_draw_attempts_event_user_date ON lucky_draw_attempts(event_id, user_id, attempt_date);
CREATE INDEX IF NOT EXISTS idx_lucky_draw_grants_user_created_at ON lucky_draw_grants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_daily_usage_date ON llm_daily_usage(usage_date, user_id);

CREATE INDEX IF NOT EXISTS idx_lab_requests_user_id ON lab_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_course_id ON lab_requests(course_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_exam_session ON lab_requests(exam_session_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_created ON lab_requests(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lab_requests_status_created ON lab_requests(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lab_exam_sessions_user_course_status ON lab_exam_sessions(user_id, course_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_exam_sessions_lab ON lab_exam_sessions(lab_request_id);
CREATE INDEX IF NOT EXISTS idx_terminal_replay_sessions_user_started ON terminal_replay_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_replay_sessions_lab_started ON terminal_replay_sessions(lab_request_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_replay_events_session_offset ON terminal_replay_events(replay_session_id, offset_ms, id);
CREATE INDEX IF NOT EXISTS idx_zun_containers_user_id ON zun_containers(user_id);
CREATE INDEX IF NOT EXISTS idx_zun_containers_project_status ON zun_containers(project_name, status);
CREATE INDEX IF NOT EXISTS idx_self_service_vms_user_id ON self_service_vms(user_id);
CREATE INDEX IF NOT EXISTS idx_magnum_clusters_user_id ON magnum_clusters(user_id);
CREATE INDEX IF NOT EXISTS idx_magnum_clusters_project_status ON magnum_clusters(project_name, status);
CREATE INDEX IF NOT EXISTS idx_trove_instances_user_id ON trove_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_trove_instances_project_status ON trove_instances(project_name, status);
CREATE INDEX IF NOT EXISTS idx_internal_image_cache_namespace_repo ON internal_image_cache(namespace, repository);
CREATE INDEX IF NOT EXISTS idx_internal_image_cache_cached_at ON internal_image_cache(cached_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_access_requests_user_id ON course_access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_arena_nodes_season_id ON arena_nodes(season_id);
CREATE INDEX IF NOT EXISTS idx_arena_sessions_user_state ON arena_sessions(user_id, state);
CREATE INDEX IF NOT EXISTS idx_arena_events_season_created ON arena_events(season_id, created_at DESC);

ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_port INTEGER;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_request_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_reviewed_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_ssh_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_port INTEGER;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_request_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_reviewed_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS requested_resize_flavor TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_request_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_reviewed_at TEXT;
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS metallb_vip_cidr TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_requests_metallb_vip_cidr_unique
  ON lab_requests (metallb_vip_cidr)
  WHERE metallb_vip_cidr <> '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_user TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_password TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS schedule_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS external_event_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_schedule_events_external_source ON schedule_events(schedule_source, external_event_id);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS terminal_replay_mode TEXT NOT NULL DEFAULT 'inherit';

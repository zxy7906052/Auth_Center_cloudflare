-- Sa-Token Cloudflare D1 数据库 Schema
-- 执行: wrangler d1 execute sa-token-db --file=./schema.sql

-- ─────────────────────────────────────────
-- Token 会话表
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_token_session (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    login_type   TEXT    NOT NULL DEFAULT 'login',
    login_id     TEXT    NOT NULL,
    token_value  TEXT    NOT NULL UNIQUE,
    device_type  TEXT    NOT NULL DEFAULT 'default',
    create_time  INTEGER NOT NULL,
    -- Unix 时间戳（秒）；NULL 表示永不过期
    expire_time  INTEGER,
    -- 最后一次活跃时间（用于活跃超时检测）
    last_active  INTEGER NOT NULL,
    -- 0=正常 1=被踢下线 2=被顶下线
    logout_type  INTEGER NOT NULL DEFAULT 0,
    -- 扩展数据 JSON 字符串
    extra        TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sts_token     ON sa_token_session(token_value);
CREATE INDEX IF NOT EXISTS idx_sts_login     ON sa_token_session(login_type, login_id);
CREATE INDEX IF NOT EXISTS idx_sts_expire    ON sa_token_session(expire_time);

-- ─────────────────────────────────────────
-- Session 数据表（账号级 Session key-value）
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_session_data (
    login_type  TEXT NOT NULL,
    login_id    TEXT NOT NULL,
    data_key    TEXT NOT NULL,
    data_value  TEXT,
    PRIMARY KEY (login_type, login_id, data_key)
);

-- ─────────────────────────────────────────
-- 用户权限表
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_user_permission (
    login_type  TEXT NOT NULL,
    login_id    TEXT NOT NULL,
    permission  TEXT NOT NULL,
    PRIMARY KEY (login_type, login_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_sup_user ON sa_user_permission(login_type, login_id);

-- ─────────────────────────────────────────
-- 用户角色表
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_user_role (
    login_type  TEXT NOT NULL,
    login_id    TEXT NOT NULL,
    role        TEXT NOT NULL,
    PRIMARY KEY (login_type, login_id, role)
);

CREATE INDEX IF NOT EXISTS idx_sur_user ON sa_user_role(login_type, login_id);

-- ─────────────────────────────────────────
-- 账号封禁表
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_account_ban (
    login_type    TEXT    NOT NULL,
    login_id      TEXT    NOT NULL,
    ban_category  TEXT    NOT NULL DEFAULT '',
    ban_level     INTEGER NOT NULL DEFAULT 1,
    -- NULL = 永久封禁
    expire_time   INTEGER,
    ban_reason    TEXT,
    PRIMARY KEY (login_type, login_id, ban_category)
);

-- ─────────────────────────────────────────
-- SSO Ticket 表
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_sso_ticket (
    ticket      TEXT    NOT NULL PRIMARY KEY,
    client      TEXT    NOT NULL DEFAULT '',
    login_type  TEXT    NOT NULL,
    login_id    TEXT    NOT NULL,
    token_value TEXT    NOT NULL,
    create_time INTEGER NOT NULL,
    expire_time INTEGER NOT NULL,
    is_used     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ticket_expire ON sa_sso_ticket(expire_time);

-- ─────────────────────────────────────────
-- SSO 客户端注册表（Server 端维护）
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_sso_client (
    client_id    TEXT NOT NULL PRIMARY KEY,
    client_name  TEXT NOT NULL DEFAULT '',
    -- 允许的回调域名，逗号分隔，* 表示不限
    allow_urls   TEXT NOT NULL DEFAULT '*',
    secret       TEXT NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────
-- 临时 Token（用于文件下载等短时授权）
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_temp_token (
    token_value TEXT    NOT NULL PRIMARY KEY,
    service     TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    create_time INTEGER NOT NULL,
    expire_time INTEGER NOT NULL
);

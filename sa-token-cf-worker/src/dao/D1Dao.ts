/**
 * D1 数据访问层
 * 封装所有对 Cloudflare D1 数据库的操作。
 */

import { nowSec } from '../config.js';
import type {
  TokenSession,
  BanRecord,
  SsoTicket,
  SsoClient,
} from '../types.js';

// ─────────────────────────────────────────
// Token 会话
// ─────────────────────────────────────────

/** 保存 token 会话 */
export async function saveTokenSession(db: D1Database, ts: TokenSession): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sa_token_session
         (login_type, login_id, token_value, device_type, create_time, expire_time, last_active, logout_type, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_value) DO UPDATE SET
         last_active = excluded.last_active,
         expire_time = excluded.expire_time,
         logout_type = excluded.logout_type,
         extra       = excluded.extra`,
    )
    .bind(
      ts.loginType,
      ts.loginId,
      ts.tokenValue,
      ts.deviceType,
      ts.createTime,
      ts.expireTime ?? null,
      ts.lastActive,
      ts.logoutType,
      JSON.stringify(ts.extra),
    )
    .run();
}

/** 通过 token 值查询会话 */
export async function getTokenSessionByToken(
  db: D1Database,
  token: string,
): Promise<TokenSession | null> {
  const row = await db
    .prepare(`SELECT * FROM sa_token_session WHERE token_value = ?`)
    .bind(token)
    .first<Record<string, unknown>>();
  return row ? mapTokenSession(row) : null;
}

/** 查询某账号的所有 token 会话 */
export async function getTokenSessionsByLoginId(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<TokenSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM sa_token_session WHERE login_type = ? AND login_id = ? ORDER BY create_time DESC`,
    )
    .bind(loginType, loginId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapTokenSession);
}

/** 查询某账号在指定设备类型上的 token 会话 */
export async function getTokenSessionsByDevice(
  db: D1Database,
  loginType: string,
  loginId: string,
  device: string,
): Promise<TokenSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM sa_token_session WHERE login_type = ? AND login_id = ? AND device_type = ? ORDER BY create_time DESC`,
    )
    .bind(loginType, loginId, device)
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapTokenSession);
}

/** 更新 token 最后活跃时间 */
export async function touchTokenSession(db: D1Database, token: string, now: number): Promise<void> {
  await db
    .prepare(`UPDATE sa_token_session SET last_active = ? WHERE token_value = ?`)
    .bind(now, token)
    .run();
}

/** 更新 token 的 logoutType */
export async function updateTokenLogoutType(
  db: D1Database,
  token: string,
  logoutType: 0 | 1 | 2,
): Promise<void> {
  await db
    .prepare(`UPDATE sa_token_session SET logout_type = ? WHERE token_value = ?`)
    .bind(logoutType, token)
    .run();
}

/** 将账号所有 token 设置为指定 logoutType */
export async function updateAllTokensLogoutType(
  db: D1Database,
  loginType: string,
  loginId: string,
  logoutType: 0 | 1 | 2,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sa_token_session SET logout_type = ? WHERE login_type = ? AND login_id = ? AND logout_type = 0`,
    )
    .bind(logoutType, loginType, loginId)
    .run();
}

/** 删除单条 token 会话 */
export async function deleteTokenSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(`DELETE FROM sa_token_session WHERE token_value = ?`)
    .bind(token)
    .run();
}

/** 删除账号的所有 token 会话 */
export async function deleteAllTokenSessions(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM sa_token_session WHERE login_type = ? AND login_id = ?`)
    .bind(loginType, loginId)
    .run();
}

/** 删除过期的 token 会话（可定期调用清理） */
export async function cleanExpiredTokenSessions(db: D1Database): Promise<void> {
  const now = nowSec();
  await db
    .prepare(`DELETE FROM sa_token_session WHERE expire_time IS NOT NULL AND expire_time < ?`)
    .bind(now)
    .run();
}

/** 统计某账号的正常会话数 */
export async function countActiveTokenSessions(
  db: D1Database,
  loginType: string,
  loginId: string,
  device: string,
): Promise<number> {
  const now = nowSec();
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM sa_token_session
       WHERE login_type = ? AND login_id = ? AND device_type = ? AND logout_type = 0
         AND (expire_time IS NULL OR expire_time > ?)`,
    )
    .bind(loginType, loginId, device, now)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

function mapTokenSession(row: Record<string, unknown>): TokenSession {
  return {
    id:          row['id']          as number | undefined,
    loginType:   row['login_type']  as string,
    loginId:     row['login_id']    as string,
    tokenValue:  row['token_value'] as string,
    deviceType:  row['device_type'] as string,
    createTime:  row['create_time'] as number,
    expireTime:  row['expire_time'] as number | null,
    lastActive:  row['last_active'] as number,
    logoutType:  row['logout_type'] as 0 | 1 | 2,
    extra:       JSON.parse((row['extra'] as string | null) ?? '{}'),
  };
}

// ─────────────────────────────────────────
// Session 数据（账号级 key-value）
// ─────────────────────────────────────────

export async function setSessionData(
  db: D1Database,
  loginType: string,
  loginId: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (value === null || value === undefined) {
    await db
      .prepare(`DELETE FROM sa_session_data WHERE login_type = ? AND login_id = ? AND data_key = ?`)
      .bind(loginType, loginId, key)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO sa_session_data (login_type, login_id, data_key, data_value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(login_type, login_id, data_key) DO UPDATE SET data_value = excluded.data_value`,
      )
      .bind(loginType, loginId, key, JSON.stringify(value))
      .run();
  }
}

export async function getSessionData(
  db: D1Database,
  loginType: string,
  loginId: string,
  key: string,
): Promise<unknown> {
  const row = await db
    .prepare(
      `SELECT data_value FROM sa_session_data WHERE login_type = ? AND login_id = ? AND data_key = ?`,
    )
    .bind(loginType, loginId, key)
    .first<{ data_value: string | null }>();
  if (!row || row.data_value === null) return null;
  return JSON.parse(row.data_value);
}

export async function getAllSessionData(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<Record<string, unknown>> {
  const { results } = await db
    .prepare(`SELECT data_key, data_value FROM sa_session_data WHERE login_type = ? AND login_id = ?`)
    .bind(loginType, loginId)
    .all<{ data_key: string; data_value: string | null }>();
  const out: Record<string, unknown> = {};
  for (const row of results ?? []) {
    out[row.data_key] = row.data_value !== null ? JSON.parse(row.data_value) : null;
  }
  return out;
}

export async function deleteAllSessionData(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM sa_session_data WHERE login_type = ? AND login_id = ?`)
    .bind(loginType, loginId)
    .run();
}

// ─────────────────────────────────────────
// 权限 / 角色
// ─────────────────────────────────────────

export async function addPermission(
  db: D1Database,
  loginType: string,
  loginId: string,
  permission: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO sa_user_permission (login_type, login_id, permission) VALUES (?, ?, ?)`,
    )
    .bind(loginType, loginId, permission)
    .run();
}

export async function removePermission(
  db: D1Database,
  loginType: string,
  loginId: string,
  permission: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM sa_user_permission WHERE login_type = ? AND login_id = ? AND permission = ?`)
    .bind(loginType, loginId, permission)
    .run();
}

export async function getPermissions(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT permission FROM sa_user_permission WHERE login_type = ? AND login_id = ?`)
    .bind(loginType, loginId)
    .all<{ permission: string }>();
  return (results ?? []).map((r) => r.permission);
}

export async function hasPermission(
  db: D1Database,
  loginType: string,
  loginId: string,
  permission: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM sa_user_permission WHERE login_type = ? AND login_id = ? AND permission = ? LIMIT 1`,
    )
    .bind(loginType, loginId, permission)
    .first();
  return !!row;
}

export async function addRole(
  db: D1Database,
  loginType: string,
  loginId: string,
  role: string,
): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO sa_user_role (login_type, login_id, role) VALUES (?, ?, ?)`)
    .bind(loginType, loginId, role)
    .run();
}

export async function removeRole(
  db: D1Database,
  loginType: string,
  loginId: string,
  role: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM sa_user_role WHERE login_type = ? AND login_id = ? AND role = ?`)
    .bind(loginType, loginId, role)
    .run();
}

export async function getRoles(
  db: D1Database,
  loginType: string,
  loginId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT role FROM sa_user_role WHERE login_type = ? AND login_id = ?`)
    .bind(loginType, loginId)
    .all<{ role: string }>();
  return (results ?? []).map((r) => r.role);
}

export async function hasRole(
  db: D1Database,
  loginType: string,
  loginId: string,
  role: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM sa_user_role WHERE login_type = ? AND login_id = ? AND role = ? LIMIT 1`)
    .bind(loginType, loginId, role)
    .first();
  return !!row;
}

// ─────────────────────────────────────────
// 账号封禁
// ─────────────────────────────────────────

export async function banAccount(db: D1Database, ban: BanRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sa_account_ban (login_type, login_id, ban_category, ban_level, expire_time, ban_reason)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(login_type, login_id, ban_category) DO UPDATE SET
         ban_level   = excluded.ban_level,
         expire_time = excluded.expire_time,
         ban_reason  = excluded.ban_reason`,
    )
    .bind(
      ban.loginType,
      ban.loginId,
      ban.banCategory,
      ban.banLevel,
      ban.expireTime ?? null,
      ban.banReason ?? null,
    )
    .run();
}

export async function unbanAccount(
  db: D1Database,
  loginType: string,
  loginId: string,
  banCategory = '',
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM sa_account_ban WHERE login_type = ? AND login_id = ? AND ban_category = ?`,
    )
    .bind(loginType, loginId, banCategory)
    .run();
}

export async function getBanRecord(
  db: D1Database,
  loginType: string,
  loginId: string,
  banCategory = '',
): Promise<BanRecord | null> {
  const now = nowSec();
  const row = await db
    .prepare(
      `SELECT * FROM sa_account_ban
       WHERE login_type = ? AND login_id = ? AND ban_category = ?
         AND (expire_time IS NULL OR expire_time > ?)
       LIMIT 1`,
    )
    .bind(loginType, loginId, banCategory, now)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    loginType:   row['login_type']   as string,
    loginId:     row['login_id']     as string,
    banCategory: row['ban_category'] as string,
    banLevel:    row['ban_level']    as number,
    expireTime:  row['expire_time']  as number | null,
    banReason:   row['ban_reason']   as string | undefined,
  };
}

export async function isAccountBanned(
  db: D1Database,
  loginType: string,
  loginId: string,
  banCategory = '',
): Promise<boolean> {
  const ban = await getBanRecord(db, loginType, loginId, banCategory);
  return !!ban;
}

// ─────────────────────────────────────────
// SSO Ticket
// ─────────────────────────────────────────

export async function saveSsoTicket(db: D1Database, t: SsoTicket): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sa_sso_ticket (ticket, client, login_type, login_id, token_value, create_time, expire_time, is_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(t.ticket, t.client, t.loginType, t.loginId, t.tokenValue, t.createTime, t.expireTime, 0)
    .run();
}

export async function getSsoTicket(
  db: D1Database,
  ticket: string,
): Promise<SsoTicket | null> {
  const row = await db
    .prepare(`SELECT * FROM sa_sso_ticket WHERE ticket = ?`)
    .bind(ticket)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    ticket:     row['ticket']      as string,
    client:     row['client']      as string,
    loginType:  row['login_type']  as string,
    loginId:    row['login_id']    as string,
    tokenValue: row['token_value'] as string,
    createTime: row['create_time'] as number,
    expireTime: row['expire_time'] as number,
    isUsed:    (row['is_used']     as number) === 1,
  };
}

export async function markTicketUsed(db: D1Database, ticket: string): Promise<void> {
  await db
    .prepare(`UPDATE sa_sso_ticket SET is_used = 1 WHERE ticket = ?`)
    .bind(ticket)
    .run();
}

export async function cleanExpiredTickets(db: D1Database): Promise<void> {
  const now = nowSec();
  await db.prepare(`DELETE FROM sa_sso_ticket WHERE expire_time < ?`).bind(now).run();
}

// ─────────────────────────────────────────
// SSO 客户端
// ─────────────────────────────────────────

export async function getSsoClient(
  db: D1Database,
  clientId: string,
): Promise<SsoClient | null> {
  const row = await db
    .prepare(`SELECT * FROM sa_sso_client WHERE client_id = ? AND is_active = 1`)
    .bind(clientId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    clientId:   row['client_id']   as string,
    clientName: row['client_name'] as string,
    allowUrls:  row['allow_urls']  as string,
    secret:     row['secret']      as string,
    isActive:  (row['is_active']   as number) === 1,
  };
}

export async function saveSsoClient(db: D1Database, client: SsoClient): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sa_sso_client (client_id, client_name, allow_urls, secret, is_active)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         client_name = excluded.client_name,
         allow_urls  = excluded.allow_urls,
         secret      = excluded.secret,
         is_active   = excluded.is_active`,
    )
    .bind(client.clientId, client.clientName, client.allowUrls, client.secret, client.isActive ? 1 : 0)
    .run();
}

// ─────────────────────────────────────────
// 临时 Token
// ─────────────────────────────────────────

export async function saveTempToken(
  db: D1Database,
  token: string,
  service: string,
  value: string,
  expireTime: number,
): Promise<void> {
  const now = nowSec();
  await db
    .prepare(
      `INSERT INTO sa_temp_token (token_value, service, value, create_time, expire_time)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(token, service, value, now, expireTime)
    .run();
}

export async function getTempToken(
  db: D1Database,
  token: string,
): Promise<{ service: string; value: string } | null> {
  const now = nowSec();
  const row = await db
    .prepare(
      `SELECT service, value FROM sa_temp_token WHERE token_value = ? AND expire_time > ?`,
    )
    .bind(token, now)
    .first<{ service: string; value: string }>();
  return row ?? null;
}

export async function deleteTempToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sa_temp_token WHERE token_value = ?`).bind(token).run();
}

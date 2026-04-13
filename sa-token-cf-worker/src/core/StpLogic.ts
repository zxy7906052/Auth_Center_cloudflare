/**
 * StpLogic — 核心认证逻辑
 *
 * 对标 Sa-Token Java 版中的 StpLogic 类，提供登录、注销、token 校验、
 * 踢人下线、账号封禁等核心功能。
 *
 * 每个 loginType（如 'login'、'admin'）对应一个 StpLogic 实例。
 */

import { buildConfig, generateToken, nowSec } from '../config.js';
import {
  saveTokenSession,
  getTokenSessionByToken,
  getTokenSessionsByLoginId,
  getTokenSessionsByDevice,
  updateTokenLogoutType,
  updateAllTokensLogoutType,
  deleteTokenSession,
  deleteAllTokenSessions,
  touchTokenSession,
  countActiveTokenSessions,
  getPermissions,
  getRoles,
  hasPermission,
  hasRole,
  getBanRecord,
  isAccountBanned,
  banAccount,
  unbanAccount,
} from '../dao/D1Dao.js';
import type {
  Env,
  LoginParameter,
  LoginResult,
  TokenSession,
  BanRecord,
  SaTokenConfig,
} from '../types.js';
import {
  SaErrorCode,
  NotLoginException,
  NotPermissionException,
  NotRoleException,
  DisableLoginException,
} from '../types.js';

export class StpLogic {
  loginType: string;

  constructor(loginType: string) {
    this.loginType = loginType;
  }

  // ─────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────

  getConfig(env: Env): SaTokenConfig {
    return buildConfig(env);
  }

  // ─────────────────────────────────────────
  // 登录
  // ─────────────────────────────────────────

  /**
   * 为账号 loginId 创建一个新 token 会话，并存储到 D1 + KV
   */
  async login(
    env: Env,
    loginId: string,
    param: LoginParameter = {},
  ): Promise<LoginResult> {
    const cfg = this.getConfig(env);
    const device = param.device ?? 'default';
    const now = nowSec();
    const timeout = param.timeout ?? cfg.timeout;
    const expireTime = timeout === -1 ? null : now + timeout;

    // 是否共享 token（同账号同设备复用同一 token）
    if (cfg.isShare && cfg.isConcurrent) {
      const existing = await getTokenSessionsByDevice(env.DB, this.loginType, loginId, device);
      const valid = existing.find((s) => s.logoutType === 0 && (s.expireTime === null || s.expireTime > now));
      if (valid) {
        // 刷新活跃时间
        await touchTokenSession(env.DB, valid.tokenValue, now);
        await this._refreshKv(env, valid.tokenValue, loginId, expireTime);
        return this._buildLoginResult(cfg, loginId, valid.tokenValue, timeout);
      }
    }

    // 并发登录超出上限时，顶掉最旧的
    if (!cfg.isConcurrent) {
      await updateAllTokensLogoutType(env.DB, this.loginType, loginId, 2);
      await this._cleanKvForUser(env, loginId);
    } else if (cfg.maxLoginCount !== -1) {
      const count = await countActiveTokenSessions(env.DB, this.loginType, loginId, device);
      if (count >= cfg.maxLoginCount) {
        const all = await getTokenSessionsByDevice(env.DB, this.loginType, loginId, device);
        const valids = all
          .filter((s) => s.logoutType === 0 && (s.expireTime === null || s.expireTime > now))
          .sort((a, b) => a.createTime - b.createTime);
        const toKick = valids.slice(0, valids.length - cfg.maxLoginCount + 1);
        for (const s of toKick) {
          await updateTokenLogoutType(env.DB, s.tokenValue, 2);
          await env.TOKEN_KV.delete(`token:${s.tokenValue}`);
        }
      }
    }

    // 生成新 token
    const tokenValue = generateToken(loginId, this.loginType, cfg.tokenStyle);
    const session: TokenSession = {
      loginType:  this.loginType,
      loginId,
      tokenValue,
      deviceType: device,
      createTime: now,
      expireTime,
      lastActive: now,
      logoutType: 0,
      extra:      param.extra ?? {},
    };

    await saveTokenSession(env.DB, session);

    // KV 存储（快速路径）；TTL 单位为秒
    const kvTtl = timeout === -1 ? undefined : timeout;
    await env.TOKEN_KV.put(
      `token:${tokenValue}`,
      JSON.stringify({ loginId, loginType: this.loginType, expireTime }),
      kvTtl ? { expirationTtl: kvTtl } : undefined,
    );

    return this._buildLoginResult(cfg, loginId, tokenValue, timeout);
  }

  // ─────────────────────────────────────────
  // 注销
  // ─────────────────────────────────────────

  /** 注销当前 token */
  async logoutByToken(env: Env, token: string): Promise<void> {
    await deleteTokenSession(env.DB, token);
    await env.TOKEN_KV.delete(`token:${token}`);
  }

  /** 注销账号的所有 token */
  async logoutByLoginId(env: Env, loginId: string): Promise<void> {
    const sessions = await getTokenSessionsByLoginId(env.DB, this.loginType, loginId);
    await deleteAllTokenSessions(env.DB, this.loginType, loginId);
    for (const s of sessions) {
      await env.TOKEN_KV.delete(`token:${s.tokenValue}`);
    }
  }

  /** 踢人下线（token 标记为被踢，不立即删除，校验时抛出特定异常） */
  async kickoutByToken(env: Env, token: string): Promise<void> {
    await updateTokenLogoutType(env.DB, token, 1);
    await env.TOKEN_KV.delete(`token:${token}`);
  }

  /** 踢账号所有 token 下线 */
  async kickoutByLoginId(env: Env, loginId: string): Promise<void> {
    const sessions = await getTokenSessionsByLoginId(env.DB, this.loginType, loginId);
    await updateAllTokensLogoutType(env.DB, this.loginType, loginId, 1);
    for (const s of sessions) {
      await env.TOKEN_KV.delete(`token:${s.tokenValue}`);
    }
  }

  // ─────────────────────────────────────────
  // Token 校验
  // ─────────────────────────────────────────

  /**
   * 校验 token 并返回 loginId；失败时抛出 NotLoginException
   */
  async checkLogin(env: Env, token: string): Promise<string> {
    if (!token) {
      throw new NotLoginException(SaErrorCode.CODE_10005, this.loginType, '未提供 token');
    }

    const cfg = this.getConfig(env);
    const now = nowSec();

    // 先走 KV 快速路径
    const kvRaw = await env.TOKEN_KV.get(`token:${token}`);
    if (kvRaw) {
      const kv = JSON.parse(kvRaw) as { loginId: string; loginType: string; expireTime: number | null };
      if (kv.loginType !== this.loginType) {
        throw new NotLoginException(SaErrorCode.CODE_10001, this.loginType, 'token 无效');
      }
      // 活跃超时检查需要走 D1
      if (cfg.activeTimeout !== -1) {
        await this._checkActiveTimeout(env, token, cfg.activeTimeout, now);
      }
      return kv.loginId;
    }

    // KV 未命中，走 D1
    const session = await getTokenSessionByToken(env.DB, token);
    if (!session || session.loginType !== this.loginType) {
      throw new NotLoginException(SaErrorCode.CODE_10001, this.loginType, 'token 无效');
    }

    if (session.logoutType === 1) {
      throw new NotLoginException(SaErrorCode.CODE_10003, this.loginType, 'token 已被踢下线');
    }
    if (session.logoutType === 2) {
      throw new NotLoginException(SaErrorCode.CODE_10004, this.loginType, 'token 已被顶下线');
    }
    if (session.expireTime !== null && session.expireTime < now) {
      throw new NotLoginException(SaErrorCode.CODE_10002, this.loginType, 'token 已过期');
    }
    if (cfg.activeTimeout !== -1 && now - session.lastActive > cfg.activeTimeout) {
      throw new NotLoginException(SaErrorCode.CODE_10002, this.loginType, 'token 活跃超时');
    }

    // 回填 KV
    const remaining = session.expireTime ? session.expireTime - now : undefined;
    await env.TOKEN_KV.put(
      `token:${token}`,
      JSON.stringify({ loginId: session.loginId, loginType: this.loginType, expireTime: session.expireTime }),
      remaining ? { expirationTtl: remaining } : undefined,
    );

    // 更新活跃时间
    if (cfg.activeTimeout !== -1) {
      await touchTokenSession(env.DB, token, now);
    }

    return session.loginId;
  }

  /** 检查是否已登录（不抛异常，返回 boolean） */
  async isLogin(env: Env, token: string): Promise<boolean> {
    try {
      await this.checkLogin(env, token);
      return true;
    } catch {
      return false;
    }
  }

  /** 获取 loginId（未登录返回 null） */
  async getLoginId(env: Env, token: string): Promise<string | null> {
    try {
      return await this.checkLogin(env, token);
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────
  // Token 信息
  // ─────────────────────────────────────────

  async getTokenSession(env: Env, token: string): Promise<TokenSession | null> {
    return getTokenSessionByToken(env.DB, token);
  }

  async getSessionsByLoginId(env: Env, loginId: string): Promise<TokenSession[]> {
    return getTokenSessionsByLoginId(env.DB, this.loginType, loginId);
  }

  /** 获取 token 剩余有效期（秒）；-1 = 永不过期；-2 = 已失效 */
  async getTokenTimeout(env: Env, token: string): Promise<number> {
    const session = await getTokenSessionByToken(env.DB, token);
    if (!session || session.logoutType !== 0) return -2;
    if (session.expireTime === null) return -1;
    const remaining = session.expireTime - nowSec();
    return remaining > 0 ? remaining : -2;
  }

  // ─────────────────────────────────────────
  // 权限 / 角色
  // ─────────────────────────────────────────

  async checkPermission(env: Env, loginId: string, permission: string): Promise<void> {
    if (permission === '*') return;
    const ok = await hasPermission(env.DB, this.loginType, loginId, permission);
    if (!ok) throw new NotPermissionException(permission);
  }

  async checkPermissionOr(env: Env, loginId: string, permissions: string[]): Promise<void> {
    for (const p of permissions) {
      if (p === '*' || (await hasPermission(env.DB, this.loginType, loginId, p))) return;
    }
    throw new NotPermissionException(permissions.join(' | '));
  }

  async checkRole(env: Env, loginId: string, role: string): Promise<void> {
    const ok = await hasRole(env.DB, this.loginType, loginId, role);
    if (!ok) throw new NotRoleException(role);
  }

  async checkRoleOr(env: Env, loginId: string, roles: string[]): Promise<void> {
    for (const r of roles) {
      if (await hasRole(env.DB, this.loginType, loginId, r)) return;
    }
    throw new NotRoleException(roles.join(' | '));
  }

  async getPermissions(env: Env, loginId: string): Promise<string[]> {
    return getPermissions(env.DB, this.loginType, loginId);
  }

  async getRoles(env: Env, loginId: string): Promise<string[]> {
    return getRoles(env.DB, this.loginType, loginId);
  }

  // ─────────────────────────────────────────
  // 账号封禁
  // ─────────────────────────────────────────

  async disable(
    env: Env,
    loginId: string,
    banCategory = '',
    banLevel = 1,
    disableTime?: number,
    reason?: string,
  ): Promise<void> {
    const now = nowSec();
    const expireTime = disableTime !== undefined && disableTime !== -1 ? now + disableTime : null;
    const ban: BanRecord = { loginType: this.loginType, loginId, banCategory, banLevel, expireTime, banReason: reason };
    await banAccount(env.DB, ban);
  }

  async untieDisable(env: Env, loginId: string, banCategory = ''): Promise<void> {
    await unbanAccount(env.DB, this.loginType, loginId, banCategory);
  }

  async isDisable(env: Env, loginId: string, banCategory = ''): Promise<boolean> {
    return isAccountBanned(env.DB, this.loginType, loginId, banCategory);
  }

  async checkDisable(env: Env, loginId: string, banCategory = ''): Promise<void> {
    const ban = await getBanRecord(env.DB, this.loginType, loginId, banCategory);
    if (ban) {
      throw new DisableLoginException(loginId, banCategory, ban.banLevel, ban.expireTime);
    }
  }

  async getDisableLevel(env: Env, loginId: string, banCategory = ''): Promise<number> {
    const ban = await getBanRecord(env.DB, this.loginType, loginId, banCategory);
    return ban?.banLevel ?? -2;
  }

  async getDisableTime(env: Env, loginId: string, banCategory = ''): Promise<number> {
    const ban = await getBanRecord(env.DB, this.loginType, loginId, banCategory);
    if (!ban) return -2;
    if (ban.expireTime === null) return -1;
    return ban.expireTime - nowSec();
  }

  // ─────────────────────────────────────────
  // 内部工具方法
  // ─────────────────────────────────────────

  private async _checkActiveTimeout(
    env: Env,
    token: string,
    activeTimeout: number,
    now: number,
  ): Promise<void> {
    const session = await getTokenSessionByToken(env.DB, token);
    if (!session) return;
    if (now - session.lastActive > activeTimeout) {
      throw new NotLoginException(SaErrorCode.CODE_10002, this.loginType, 'token 活跃超时');
    }
    await touchTokenSession(env.DB, token, now);
  }

  private async _refreshKv(
    env: Env,
    token: string,
    loginId: string,
    expireTime: number | null,
  ): Promise<void> {
    const remaining = expireTime ? expireTime - nowSec() : undefined;
    await env.TOKEN_KV.put(
      `token:${token}`,
      JSON.stringify({ loginId, loginType: this.loginType, expireTime }),
      remaining && remaining > 0 ? { expirationTtl: remaining } : undefined,
    );
  }

  private async _cleanKvForUser(env: Env, loginId: string): Promise<void> {
    const sessions = await getTokenSessionsByLoginId(env.DB, this.loginType, loginId);
    for (const s of sessions) {
      await env.TOKEN_KV.delete(`token:${s.tokenValue}`);
    }
  }

  private _buildLoginResult(
    cfg: SaTokenConfig,
    loginId: string,
    tokenValue: string,
    timeout: number,
  ): LoginResult {
    return {
      loginId,
      tokenName: cfg.tokenName,
      tokenValue,
      isLogin: true,
      loginType: this.loginType,
      tokenTimeout: timeout === -1 ? null : timeout,
      sessionTimeout: timeout === -1 ? null : timeout,
    };
  }
}

// 默认实例（loginType = 'login'）
export const StpUtil = new StpLogic('login');

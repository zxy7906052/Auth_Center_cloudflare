/**
 * SSO 服务端核心逻辑
 *
 * 对标 Sa-Token Java 版 SaSsoServerTemplate，实现：
 * - 生成并保存 Ticket
 * - 校验 Ticket（含签名验证）
 * - 单点注销通知 Client
 * - Client 注册管理
 */

import { randomString, hmacSha256, timingSafeEqual, isAllowUrl, nowSec } from '../config.js';
import {
  saveSsoTicket,
  getSsoTicket,
  markTicketUsed,
  cleanExpiredTickets,
  getSsoClient,
  saveSsoClient,
} from '../dao/D1Dao.js';
import { StpUtil } from '../core/StpLogic.js';
import type { Env, SsoTicket, SsoClient } from '../types.js';
import { SaErrorCode, SaSsoException } from '../types.js';

export class SaSsoServer {
  // ─────────────────────────────────────────
  // Ticket 操作
  // ─────────────────────────────────────────

  /**
   * 为已登录用户创建 ticket，并持久化
   */
  async createTicket(env: Env, loginId: string, token: string, client = ''): Promise<string> {
    const ticketTimeout = parseInt(env.SSO_TICKET_TIMEOUT ?? '300', 10);
    const now = nowSec();
    const ticket = randomString(64);

    const ssoTicket: SsoTicket = {
      ticket,
      client,
      loginType:  'login',
      loginId,
      tokenValue: token,
      createTime: now,
      expireTime: now + ticketTimeout,
      isUsed:     false,
    };

    await saveSsoTicket(env.DB, ssoTicket);
    return ticket;
  }

  /**
   * 校验 ticket，返回账号信息；ticket 无效/过期/已用时抛出异常
   */
  async checkTicket(env: Env, ticket: string): Promise<SsoTicket> {
    const now = nowSec();
    const t = await getSsoTicket(env.DB, ticket);
    if (!t) {
      throw new SaSsoException(SaErrorCode.CODE_20001, 'ticket 无效');
    }
    if (t.expireTime < now) {
      throw new SaSsoException(SaErrorCode.CODE_20002, 'ticket 已过期');
    }
    if (t.isUsed) {
      throw new SaSsoException(SaErrorCode.CODE_20003, 'ticket 已被使用');
    }
    // 标记为已使用（一次性）
    await markTicketUsed(env.DB, ticket);
    return t;
  }

  // ─────────────────────────────────────────
  // 签名
  // ─────────────────────────────────────────

  /**
   * 生成请求签名（timestamp + nonce + params）
   */
  async sign(env: Env, params: Record<string, string>): Promise<string> {
    const secret = env.SSO_SECRET_KEY ?? '';
    const sorted = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return hmacSha256(secret, sorted);
  }

  /**
   * 校验签名
   */
  async checkSign(
    env: Env,
    params: Record<string, string>,
    sign: string,
  ): Promise<void> {
    const expected = await this.sign(env, params);
    if (!timingSafeEqual(expected, sign)) {
      throw new SaSsoException(SaErrorCode.CODE_20005, '签名校验失败');
    }
  }

  // ─────────────────────────────────────────
  // redirect URL 校验
  // ─────────────────────────────────────────

  /**
   * 校验 redirect URL 是否合法（根据 client 的 allowUrls 配置）
   */
  async checkRedirectUrl(env: Env, redirectUrl: string, clientId: string): Promise<void> {
    if (!clientId) return; // 未指定 client，跳过
    const client = await getSsoClient(env.DB, clientId);
    if (!client) {
      throw new SaSsoException(SaErrorCode.CODE_20004, `未知的 SSO Client: ${clientId}`);
    }
    if (!isAllowUrl(redirectUrl, client.allowUrls)) {
      throw new SaSsoException(SaErrorCode.CODE_20004, `redirect url 不在允许范围内: ${redirectUrl}`);
    }
  }

  // ─────────────────────────────────────────
  // 单点注销
  // ─────────────────────────────────────────

  /**
   * 处理 Client 发来的单点注销请求（注销 Server 端 + 通知所有 Client）
   */
  async singleLogout(env: Env, loginId: string): Promise<void> {
    await StpUtil.logoutByLoginId(env, loginId);
    // 生产环境可在此向各 Client 发送注销通知（HTTP callback）
  }

  // ─────────────────────────────────────────
  // Client 管理
  // ─────────────────────────────────────────

  async registerClient(env: Env, client: SsoClient): Promise<void> {
    await saveSsoClient(env.DB, client);
  }

  async getClient(env: Env, clientId: string): Promise<SsoClient | null> {
    return getSsoClient(env.DB, clientId);
  }

  // ─────────────────────────────────────────
  // 维护
  // ─────────────────────────────────────────

  async cleanExpired(env: Env): Promise<void> {
    await cleanExpiredTickets(env.DB);
  }
}

export const ssoServer = new SaSsoServer();

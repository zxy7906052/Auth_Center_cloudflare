/**
 * SSO 客户端逻辑
 *
 * 对标 Sa-Token Java 版 SaSsoClientTemplate，实现：
 * - 构建登录跳转 URL
 * - 向 SSO Server 校验 Ticket
 * - 发起单点注销
 */

import { hmacSha256, nowSec, randomString } from '../config.js';
import { StpUtil } from '../core/StpLogic.js';
import type { Env, LoginResult } from '../types.js';
import { SaErrorCode, SaSsoException } from '../types.js';

export class SaSsoClient {
  /**
   * 构建 SSO 登录页面 URL（重定向到 SSO Server）
   * @param env           Worker 环境
   * @param redirectUrl   登录成功后的回调地址（Client 的当前页面地址）
   * @param clientId      本 Client 标识
   */
  buildLoginUrl(env: Env, redirectUrl: string, clientId = ''): string {
    const serverUrl = env.SSO_SERVER_URL;
    if (!serverUrl) throw new SaSsoException(SaErrorCode.CODE_20004, '未配置 SSO_SERVER_URL');
    const url = new URL(`${serverUrl}/sso/auth`);
    url.searchParams.set('redirect', redirectUrl);
    if (clientId) url.searchParams.set('client', clientId);
    return url.toString();
  }

  /**
   * 构建单点注销 URL
   */
  buildLogoutUrl(env: Env, redirectUrl: string): string {
    const serverUrl = env.SSO_SERVER_URL;
    if (!serverUrl) throw new SaSsoException(SaErrorCode.CODE_20004, '未配置 SSO_SERVER_URL');
    const url = new URL(`${serverUrl}/sso/logout`);
    url.searchParams.set('redirect', redirectUrl);
    return url.toString();
  }

  /**
   * 向 SSO Server 校验 ticket，返回 loginId 并在本地建立会话
   */
  async checkTicket(
    env: Env,
    ticket: string,
    clientId = '',
    clientSecret = '',
  ): Promise<LoginResult> {
    const serverUrl = env.SSO_SERVER_URL;
    if (!serverUrl) throw new SaSsoException(SaErrorCode.CODE_20004, '未配置 SSO_SERVER_URL');

    // 构建带签名的请求
    const timestamp = String(nowSec());
    const nonce = randomString(16);
    const params: Record<string, string> = { ticket, timestamp, nonce };
    if (clientId) params['client'] = clientId;

    // 签名
    const secret = clientSecret || env.SSO_SECRET_KEY || '';
    const sign = await this._sign(secret, params);
    params['sign'] = sign;

    // 请求 Server 校验
    const queryStr = new URLSearchParams(params).toString();
    const resp = await fetch(`${serverUrl}/sso/checkTicket?${queryStr}`);
    if (!resp.ok) {
      throw new SaSsoException(SaErrorCode.CODE_20001, `SSO Server 响应异常: ${resp.status}`);
    }
    const json = (await resp.json()) as { code: number; msg: string; data: { loginId: string } };
    if (json.code !== 200) {
      throw new SaSsoException(json.code, json.msg);
    }

    const { loginId } = json.data;

    // 在本地创建 session
    const result = await StpUtil.login(env, loginId);
    return result;
  }

  /**
   * 生成签名（与 Server 端保持一致）
   */
  private async _sign(secret: string, params: Record<string, string>): Promise<string> {
    const sorted = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return hmacSha256(secret, sorted);
  }
}

export const ssoClient = new SaSsoClient();

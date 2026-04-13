/**
 * Sa-Token 配置模块
 * 从 Cloudflare Workers 环境变量中读取配置，并提供默认值。
 */

import type { Env, SaTokenConfig } from './types.js';

export function buildConfig(env: Env): SaTokenConfig {
  return {
    tokenName:      env.SA_TOKEN_NAME        ?? 'satoken',
    timeout:        parseInt(env.SA_TOKEN_TIMEOUT        ?? '2592000', 10),
    activeTimeout:  parseInt(env.SA_TOKEN_ACTIVE_TIMEOUT ?? '-1',      10),
    isConcurrent:  (env.SA_TOKEN_IS_CONCURRENT ?? 'true') === 'true',
    isShare:       (env.SA_TOKEN_IS_SHARE      ?? 'true') === 'true',
    maxLoginCount:  parseInt(env.SA_TOKEN_MAX_LOGIN_COUNT ?? '12',     10),
    tokenStyle:    'uuid',
  };
}

/** 生成随机字符串（用于 token / ticket） */
export function randomString(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

/** 生成标准 UUID v4 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/** 生成 token（根据 tokenStyle） */
export function generateToken(
  _loginId: string,
  _loginType: string,
  style: SaTokenConfig['tokenStyle'] = 'uuid',
): string {
  switch (style) {
    case 'random-32':  return randomString(32);
    case 'random-64':  return randomString(64);
    case 'random-128': return randomString(128);
    default:           return generateUUID();
  }
}

/** 当前 Unix 时间戳（秒） */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 统一成功响应 */
export function ok<T>(data: T, msg = 'ok') {
  return { code: 200, msg, data };
}

/** 统一失败响应 */
export function fail(code: number, msg: string) {
  return { code, msg, data: null };
}

/** HMAC-SHA256 签名（用于 SSO ticket 校验） */
export async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 时序安全的字符串比较（防止计时攻击） */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < encA.length; i++) {
    diff |= (encA[i] ?? 0) ^ (encB[i] ?? 0);
  }
  return diff === 0;
}

/** 判断 redirect url 是否在允许列表中 */
export function isAllowUrl(redirectUrl: string, allowUrls: string): boolean {
  if (!allowUrls || allowUrls.trim() === '*') return true;
  const list = allowUrls.split(',').map((s) => s.trim());
  for (const pattern of list) {
    if (pattern === '*') return true;
    if (redirectUrl.startsWith(pattern)) return true;
  }
  return false;
}

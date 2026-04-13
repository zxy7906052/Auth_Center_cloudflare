/**
 * Sa-Token Cloudflare Workers — 全局类型定义
 */

// ─────────────────────────────────────────
// Cloudflare Workers 环境绑定
// ─────────────────────────────────────────
export interface Env {
  /** D1 数据库 */
  DB: D1Database;
  /** KV 命名空间（token 快速缓存） */
  TOKEN_KV: KVNamespace;
  /** Token 名称 */
  SA_TOKEN_NAME: string;
  /** token 默认有效期（秒） */
  SA_TOKEN_TIMEOUT: string;
  /** 活跃有效期（秒） */
  SA_TOKEN_ACTIVE_TIMEOUT: string;
  /** 是否允许并发登录 */
  SA_TOKEN_IS_CONCURRENT: string;
  /** 并发时是否共享同一 token */
  SA_TOKEN_IS_SHARE: string;
  /** 最大同端登录数 */
  SA_TOKEN_MAX_LOGIN_COUNT: string;
  /** SSO 服务端地址 */
  SSO_SERVER_URL: string;
  /** SSO 签名密钥 */
  SSO_SECRET_KEY: string;
  /** ticket 有效期（秒） */
  SSO_TICKET_TIMEOUT: string;
}

// ─────────────────────────────────────────
// Sa-Token 配置
// ─────────────────────────────────────────
export interface SaTokenConfig {
  tokenName: string;
  timeout: number;
  activeTimeout: number;
  isConcurrent: boolean;
  isShare: boolean;
  maxLoginCount: number;
  tokenStyle: 'uuid' | 'random-32' | 'random-64' | 'random-128';
}

// ─────────────────────────────────────────
// Token 会话记录（对应 D1 sa_token_session）
// ─────────────────────────────────────────
export interface TokenSession {
  id?: number;
  loginType: string;
  loginId: string;
  tokenValue: string;
  deviceType: string;
  createTime: number;
  expireTime: number | null;
  lastActive: number;
  /** 0=正常 1=被踢下线 2=被顶下线 */
  logoutType: 0 | 1 | 2;
  extra: Record<string, unknown>;
}

// ─────────────────────────────────────────
// 登录参数
// ─────────────────────────────────────────
export interface LoginParameter {
  /** 设备类型，默认 'default' */
  device?: string;
  /** 是否记住我（影响 cookie 有效期） */
  isLastingCookie?: boolean;
  /** 指定该 token 的有效期（秒），优先于全局配置 */
  timeout?: number;
  /** 扩展数据 */
  extra?: Record<string, unknown>;
}

// ─────────────────────────────────────────
// 登录结果
// ─────────────────────────────────────────
export interface LoginResult {
  loginId: string;
  tokenName: string;
  tokenValue: string;
  isLogin: boolean;
  loginType: string;
  tokenTimeout: number | null;
  sessionTimeout: number | null;
}

// ─────────────────────────────────────────
// SSO Ticket
// ─────────────────────────────────────────
export interface SsoTicket {
  ticket: string;
  client: string;
  loginType: string;
  loginId: string;
  tokenValue: string;
  createTime: number;
  expireTime: number;
  isUsed: boolean;
}

// ─────────────────────────────────────────
// SSO 客户端配置
// ─────────────────────────────────────────
export interface SsoClient {
  clientId: string;
  clientName: string;
  allowUrls: string;
  secret: string;
  isActive: boolean;
}

// ─────────────────────────────────────────
// 封禁记录
// ─────────────────────────────────────────
export interface BanRecord {
  loginType: string;
  loginId: string;
  banCategory: string;
  banLevel: number;
  expireTime: number | null;
  banReason?: string;
}

// ─────────────────────────────────────────
// 统一 API 响应
// ─────────────────────────────────────────
export interface SaResult<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

// ─────────────────────────────────────────
// 异常代码
// ─────────────────────────────────────────
export const SaErrorCode = {
  // 通用
  CODE_10001: 10001, // token 无效
  CODE_10002: 10002, // token 已过期
  CODE_10003: 10003, // token 已被踢下线
  CODE_10004: 10004, // token 已被顶下线
  CODE_10005: 10005, // 未提供 token
  CODE_10011: 10011, // 无此权限
  CODE_10012: 10012, // 无此角色
  CODE_10013: 10013, // 账号已被封禁
  // SSO
  CODE_20001: 20001, // ticket 无效
  CODE_20002: 20002, // ticket 已过期
  CODE_20003: 20003, // ticket 已被使用
  CODE_20004: 20004, // redirect url 不合法
  CODE_20005: 20005, // 签名校验失败
} as const;

export type SaErrorCodeType = (typeof SaErrorCode)[keyof typeof SaErrorCode];

// ─────────────────────────────────────────
// 自定义异常
// ─────────────────────────────────────────
export class SaTokenException extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'SaTokenException';
  }
}

export class NotLoginException extends SaTokenException {
  loginType: string;
  constructor(code: number, loginType: string, message: string) {
    super(code, message);
    this.loginType = loginType;
    this.name = 'NotLoginException';
  }
}

export class NotPermissionException extends SaTokenException {
  permission: string;
  constructor(permission: string) {
    super(SaErrorCode.CODE_10011, `无此权限: ${permission}`);
    this.permission = permission;
    this.name = 'NotPermissionException';
  }
}

export class NotRoleException extends SaTokenException {
  role: string;
  constructor(role: string) {
    super(SaErrorCode.CODE_10012, `无此角色: ${role}`);
    this.role = role;
    this.name = 'NotRoleException';
  }
}

export class DisableLoginException extends SaTokenException {
  loginId: string;
  banCategory: string;
  banLevel: number;
  expireTime: number | null;
  constructor(loginId: string, banCategory: string, banLevel: number, expireTime: number | null) {
    super(SaErrorCode.CODE_10013, `账号 ${loginId} 已被封禁 [category=${banCategory}]`);
    this.loginId = loginId;
    this.banCategory = banCategory;
    this.banLevel = banLevel;
    this.expireTime = expireTime;
    this.name = 'DisableLoginException';
  }
}

export class SaSsoException extends SaTokenException {
  constructor(code: number, message: string) {
    super(code, message);
    this.name = 'SaSsoException';
  }
}

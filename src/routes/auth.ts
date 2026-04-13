/**
 * 认证路由
 *
 * 提供登录、注销、Token 查询、Session 操作、权限/角色管理、封禁管理等 REST API。
 *
 * 前缀: /auth
 */

import { Hono } from 'hono';
import { StpUtil, StpLogic } from '../core/StpLogic.js';
import { getSession } from '../core/SaSession.js';
import { SaTempTokenUtil } from '../core/SaTempToken.js';
import { ok, fail } from '../config.js';
import type { Env } from '../types.js';
import {
  SaTokenException,
  NotLoginException,
  NotPermissionException,
  NotRoleException,
  DisableLoginException,
  SaErrorCode,
} from '../types.js';
import {
  addPermission,
  removePermission,
  addRole,
  removeRole,
} from '../dao/D1Dao.js';

// 从请求中提取 token
function extractToken(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined; cookie?: (name: string) => string | undefined } }, tokenName: string): string {
  return (
    c.req.header(tokenName) ??
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    c.req.query(tokenName) ??
    ''
  );
}

// 获取 StpLogic 实例（支持多账号体系）
function getStpLogic(loginType?: string): StpLogic {
  if (!loginType || loginType === 'login') return StpUtil;
  return new StpLogic(loginType);
}

export const authRouter = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────
// 登录
// ─────────────────────────────────────────

/**
 * POST /auth/login
 * body: { loginId, device?, timeout?, extra?, loginType? }
 * 响应: { code, msg, data: { tokenName, tokenValue, loginId, ... } }
 */
authRouter.post('/login', async (c) => {
  const body = await c.req.json<{
    loginId: string;
    device?: string;
    timeout?: number;
    extra?: Record<string, unknown>;
    loginType?: string;
  }>();

  if (!body.loginId) {
    return c.json(fail(400, 'loginId 不能为空'), 400);
  }

  const stp = getStpLogic(body.loginType);
  const result = await stp.login(c.env, String(body.loginId), {
    device:  body.device,
    timeout: body.timeout,
    extra:   body.extra,
  });

  return c.json(ok(result));
});

// ─────────────────────────────────────────
// 注销
// ─────────────────────────────────────────

/**
 * POST /auth/logout
 * 注销当前 token
 */
authRouter.post('/logout', async (c) => {
  const cfg = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);
  if (token) {
    await StpUtil.logoutByToken(c.env, token);
  }
  return c.json(ok(null, '注销成功'));
});

/**
 * POST /auth/kickout
 * body: { loginId, loginType? }
 * 踢指定账号下线
 */
authRouter.post('/kickout', async (c) => {
  const body = await c.req.json<{ loginId: string; loginType?: string }>();
  const stp = getStpLogic(body.loginType);
  await stp.kickoutByLoginId(c.env, String(body.loginId));
  return c.json(ok(null, '踢人成功'));
});

/**
 * POST /auth/kickout-token
 * body: { token, loginType? }
 */
authRouter.post('/kickout-token', async (c) => {
  const body = await c.req.json<{ token: string; loginType?: string }>();
  const stp = getStpLogic(body.loginType);
  await stp.kickoutByToken(c.env, body.token);
  return c.json(ok(null, '踢人成功'));
});

// ─────────────────────────────────────────
// Token 信息
// ─────────────────────────────────────────

/**
 * GET /auth/token-info
 * 返回当前 token 对应的信息
 */
authRouter.get('/token-info', async (c) => {
  const cfg = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);

  try {
    const loginId = await StpUtil.checkLogin(c.env, token);
    const timeout = await StpUtil.getTokenTimeout(c.env, token);
    return c.json(ok({ loginId, tokenValue: token, tokenTimeout: timeout, isLogin: true }));
  } catch (e) {
    if (e instanceof NotLoginException) {
      return c.json(ok({ isLogin: false, loginId: null, tokenValue: token, notLoginCode: e.code }));
    }
    throw e;
  }
});

/**
 * GET /auth/is-login
 * 判断当前是否已登录
 */
authRouter.get('/is-login', async (c) => {
  const cfg = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);
  const isLogin = await StpUtil.isLogin(c.env, token);
  return c.json(ok({ isLogin }));
});

/**
 * GET /auth/check-login
 * 强制校验登录，未登录时返回错误信息
 */
authRouter.get('/check-login', async (c) => {
  const cfg = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);
  try {
    const loginId = await StpUtil.checkLogin(c.env, token);
    return c.json(ok({ loginId }));
  } catch (e) {
    if (e instanceof NotLoginException) {
      return c.json(fail(e.code, e.message), 401);
    }
    throw e;
  }
});

// ─────────────────────────────────────────
// Session 操作
// ─────────────────────────────────────────

/**
 * GET /auth/session/:loginId
 * 获取账号的所有 session 数据
 */
authRouter.get('/session/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const session = getSession(c.env, loginType, loginId);
  const data = await session.getAll();
  return c.json(ok(data));
});

/**
 * POST /auth/session/:loginId/set
 * body: { key, value, loginType? }
 */
authRouter.post('/session/:loginId/set', async (c) => {
  const loginId = c.req.param('loginId');
  const body = await c.req.json<{ key: string; value: unknown; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  const session = getSession(c.env, loginType, loginId);
  await session.set(body.key, body.value);
  return c.json(ok(null));
});

/**
 * DELETE /auth/session/:loginId
 * 清空账号 session
 */
authRouter.delete('/session/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const session = getSession(c.env, loginType, loginId);
  await session.clear();
  return c.json(ok(null));
});

// ─────────────────────────────────────────
// 权限管理
// ─────────────────────────────────────────

/**
 * GET /auth/permission/:loginId
 * 获取账号的所有权限
 */
authRouter.get('/permission/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const permissions = await StpUtil.getPermissions(c.env, loginId);
  return c.json(ok({ loginId, loginType, permissions }));
});

/**
 * POST /auth/permission/add
 * body: { loginId, permission, loginType? }
 */
authRouter.post('/permission/add', async (c) => {
  const body = await c.req.json<{ loginId: string; permission: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  await addPermission(c.env.DB, loginType, String(body.loginId), body.permission);
  return c.json(ok(null));
});

/**
 * POST /auth/permission/remove
 * body: { loginId, permission, loginType? }
 */
authRouter.post('/permission/remove', async (c) => {
  const body = await c.req.json<{ loginId: string; permission: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  await removePermission(c.env.DB, loginType, String(body.loginId), body.permission);
  return c.json(ok(null));
});

/**
 * POST /auth/permission/check
 * body: { loginId, permission, loginType? }
 */
authRouter.post('/permission/check', async (c) => {
  const body = await c.req.json<{ loginId: string; permission: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  const stp = getStpLogic(loginType);
  try {
    await stp.checkPermission(c.env, String(body.loginId), body.permission);
    return c.json(ok({ hasPermission: true }));
  } catch (e) {
    if (e instanceof NotPermissionException) {
      return c.json(fail(e.code, e.message), 403);
    }
    throw e;
  }
});

// ─────────────────────────────────────────
// 角色管理
// ─────────────────────────────────────────

/**
 * GET /auth/role/:loginId
 */
authRouter.get('/role/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const stp = getStpLogic(loginType);
  const roles = await stp.getRoles(c.env, loginId);
  return c.json(ok({ loginId, loginType, roles }));
});

/**
 * POST /auth/role/add
 * body: { loginId, role, loginType? }
 */
authRouter.post('/role/add', async (c) => {
  const body = await c.req.json<{ loginId: string; role: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  await addRole(c.env.DB, loginType, String(body.loginId), body.role);
  return c.json(ok(null));
});

/**
 * POST /auth/role/remove
 * body: { loginId, role, loginType? }
 */
authRouter.post('/role/remove', async (c) => {
  const body = await c.req.json<{ loginId: string; role: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  await removeRole(c.env.DB, loginType, String(body.loginId), body.role);
  return c.json(ok(null));
});

/**
 * POST /auth/role/check
 * body: { loginId, role, loginType? }
 */
authRouter.post('/role/check', async (c) => {
  const body = await c.req.json<{ loginId: string; role: string; loginType?: string }>();
  const loginType = body.loginType ?? 'login';
  const stp = getStpLogic(loginType);
  try {
    await stp.checkRole(c.env, String(body.loginId), body.role);
    return c.json(ok({ hasRole: true }));
  } catch (e) {
    if (e instanceof NotRoleException) {
      return c.json(fail(e.code, e.message), 403);
    }
    throw e;
  }
});

// ─────────────────────────────────────────
// 账号封禁
// ─────────────────────────────────────────

/**
 * POST /auth/disable
 * body: { loginId, banCategory?, banLevel?, disableTime?, reason?, loginType? }
 */
authRouter.post('/disable', async (c) => {
  const body = await c.req.json<{
    loginId: string;
    banCategory?: string;
    banLevel?: number;
    disableTime?: number;
    reason?: string;
    loginType?: string;
  }>();
  const stp = getStpLogic(body.loginType);
  await stp.disable(
    c.env,
    String(body.loginId),
    body.banCategory,
    body.banLevel,
    body.disableTime,
    body.reason,
  );
  return c.json(ok(null, '封禁成功'));
});

/**
 * POST /auth/untie-disable
 * body: { loginId, banCategory?, loginType? }
 */
authRouter.post('/untie-disable', async (c) => {
  const body = await c.req.json<{ loginId: string; banCategory?: string; loginType?: string }>();
  const stp = getStpLogic(body.loginType);
  await stp.untieDisable(c.env, String(body.loginId), body.banCategory);
  return c.json(ok(null, '解封成功'));
});

/**
 * GET /auth/disable-info/:loginId
 * 查询封禁信息
 */
authRouter.get('/disable-info/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const banCategory = c.req.query('banCategory') ?? '';
  const stp = getStpLogic(loginType);
  const isDisabled = await stp.isDisable(c.env, loginId, banCategory);
  const level = await stp.getDisableLevel(c.env, loginId, banCategory);
  const time = await stp.getDisableTime(c.env, loginId, banCategory);
  return c.json(ok({ loginId, loginType, banCategory, isDisabled, banLevel: level, disableTime: time }));
});

// ─────────────────────────────────────────
// 临时 Token
// ─────────────────────────────────────────

/**
 * POST /auth/temp-token/create
 * body: { service, value, timeout }
 */
authRouter.post('/temp-token/create', async (c) => {
  const body = await c.req.json<{ service: string; value: string; timeout: number }>();
  const token = await SaTempTokenUtil.create(c.env, body.service, body.value, body.timeout);
  return c.json(ok({ token }));
});

/**
 * GET /auth/temp-token/parse
 * query: token, service?
 */
authRouter.get('/temp-token/parse', async (c) => {
  const token = c.req.query('token') ?? '';
  const service = c.req.query('service');
  const value = service
    ? await SaTempTokenUtil.parseByService(c.env, token, service)
    : await SaTempTokenUtil.parse(c.env, token);
  if (!value) return c.json(fail(SaErrorCode.CODE_10001, '临时 token 无效或已过期'), 400);
  return c.json(ok({ value }));
});

// ─────────────────────────────────────────
// 多账号信息
// ─────────────────────────────────────────

/**
 * GET /auth/sessions/:loginId
 * 获取账号的所有 token 会话列表
 */
authRouter.get('/sessions/:loginId', async (c) => {
  const loginId = c.req.param('loginId');
  const loginType = c.req.query('loginType') ?? 'login';
  const stp = getStpLogic(loginType);
  const sessions = await stp.getSessionsByLoginId(c.env, loginId);
  return c.json(ok(sessions));
});

// ─────────────────────────────────────────
// 错误处理中间件
// ─────────────────────────────────────────
authRouter.onError((err, c) => {
  if (err instanceof DisableLoginException) {
    return c.json(
      fail(err.code, err.message),
      403,
    );
  }
  if (err instanceof SaTokenException) {
    return c.json(fail(err.code, err.message), 400);
  }
  console.error('[auth]', err);
  return c.json(fail(500, '服务器内部错误'), 500);
});

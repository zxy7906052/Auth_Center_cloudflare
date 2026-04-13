/**
 * 认证中间件
 *
 * 提供在路由层面进行 token 校验、权限校验的 Hono 中间件工厂。
 */

import type { MiddlewareHandler } from 'hono';
import { StpLogic, StpUtil } from '../core/StpLogic.js';
import { fail } from '../config.js';
import type { Env } from '../types.js';
import {
  NotLoginException,
  NotPermissionException,
  NotRoleException,
  DisableLoginException,
} from '../types.js';

// 从请求中提取 token
function extractToken(
  req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined },
  tokenName: string,
): string {
  return (
    req.header(tokenName) ??
    req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    req.query(tokenName) ??
    ''
  );
}

/**
 * 要求登录中间件
 * 未登录时返回 401
 */
export function requireLogin(loginType = 'login'): MiddlewareHandler<{ Bindings: Env }> {
  const stp = loginType === 'login' ? StpUtil : new StpLogic(loginType);

  return async (c, next) => {
    const cfg   = stp.getConfig(c.env);
    const token = extractToken(c.req, cfg.tokenName);

    try {
      const loginId = await stp.checkLogin(c.env, token);
      // 将 loginId 存入请求上下文，供后续中间件/处理器使用
      c.set('loginId' as never, loginId as never);
      c.set('loginType' as never, loginType as never);
      c.set('token' as never, token as never);
      await next();
    } catch (e) {
      if (e instanceof NotLoginException) {
        return c.json(fail(e.code, e.message), 401);
      }
      if (e instanceof DisableLoginException) {
        return c.json(fail(e.code, e.message), 403);
      }
      throw e;
    }
  };
}

/**
 * 要求具有指定权限中间件
 * 未登录或无权限时返回相应状态码
 */
export function requirePermission(
  permission: string,
  loginType = 'login',
): MiddlewareHandler<{ Bindings: Env }> {
  const stp = loginType === 'login' ? StpUtil : new StpLogic(loginType);

  return async (c, next) => {
    const cfg   = stp.getConfig(c.env);
    const token = extractToken(c.req, cfg.tokenName);

    try {
      const loginId = await stp.checkLogin(c.env, token);
      await stp.checkPermission(c.env, loginId, permission);
      c.set('loginId' as never, loginId as never);
      await next();
    } catch (e) {
      if (e instanceof NotLoginException) {
        return c.json(fail(e.code, e.message), 401);
      }
      if (e instanceof NotPermissionException) {
        return c.json(fail(e.code, e.message), 403);
      }
      if (e instanceof DisableLoginException) {
        return c.json(fail(e.code, e.message), 403);
      }
      throw e;
    }
  };
}

/**
 * 要求具有指定角色中间件
 */
export function requireRole(
  role: string,
  loginType = 'login',
): MiddlewareHandler<{ Bindings: Env }> {
  const stp = loginType === 'login' ? StpUtil : new StpLogic(loginType);

  return async (c, next) => {
    const cfg   = stp.getConfig(c.env);
    const token = extractToken(c.req, cfg.tokenName);

    try {
      const loginId = await stp.checkLogin(c.env, token);
      await stp.checkRole(c.env, loginId, role);
      c.set('loginId' as never, loginId as never);
      await next();
    } catch (e) {
      if (e instanceof NotLoginException) {
        return c.json(fail(e.code, e.message), 401);
      }
      if (e instanceof NotRoleException) {
        return c.json(fail(e.code, e.message), 403);
      }
      if (e instanceof DisableLoginException) {
        return c.json(fail(e.code, e.message), 403);
      }
      throw e;
    }
  };
}

/**
 * 封禁检查中间件
 */
export function checkNotDisabled(
  banCategory = '',
  loginType = 'login',
): MiddlewareHandler<{ Bindings: Env }> {
  const stp = loginType === 'login' ? StpUtil : new StpLogic(loginType);

  return async (c, next) => {
    const cfg   = stp.getConfig(c.env);
    const token = extractToken(c.req, cfg.tokenName);

    try {
      const loginId = await stp.checkLogin(c.env, token);
      await stp.checkDisable(c.env, loginId, banCategory);
      await next();
    } catch (e) {
      if (e instanceof NotLoginException) {
        return c.json(fail(e.code, e.message), 401);
      }
      if (e instanceof DisableLoginException) {
        return c.json(fail(e.code, e.message), 403);
      }
      throw e;
    }
  };
}

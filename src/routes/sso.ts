/**
 * SSO 路由
 *
 * 同时支持 SSO Server 端和 SSO Client 端路由，通过环境变量区分角色：
 * - 若 SSO_SERVER_URL 为空，则当前 Worker 是 SSO Server
 * - 若 SSO_SERVER_URL 有值，则当前 Worker 是 SSO Client
 *
 * 前缀: /sso
 */

import { Hono } from 'hono';
import { StpUtil } from '../core/StpLogic.js';
import { ssoServer } from '../sso/SaSsoServer.js';
import { ssoClient } from '../sso/SaSsoClient.js';
import { requireLogin, requireRole } from '../middleware/auth.js';
import { ok, fail, nowSec } from '../config.js';
import type { Env } from '../types.js';
import { SaSsoException, SaTokenException, SaErrorCode } from '../types.js';

export const ssoRouter = new Hono<{ Bindings: Env }>();

// 从请求中提取 token
function extractToken(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }, tokenName: string): string {
  return (
    c.req.header(tokenName) ??
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    c.req.query(tokenName) ??
    ''
  );
}

// ─────────────────────────────────────────
// SSO Server 端路由
// ─────────────────────────────────────────

/**
 * GET /sso/auth
 * SSO 认证页面入口。
 *
 * 流程：
 * 1. 若未登录 → 重定向到登录页面（带 redirect 参数）
 * 2. 若已登录 → 生成 ticket → 重定向回 Client 的 redirect URL
 *
 * query: redirect=<client_callback_url>, client=<client_id>
 */
ssoRouter.get('/auth', async (c) => {
  const redirect = c.req.query('redirect') ?? '';
  const client   = c.req.query('client')   ?? '';

  if (!redirect) {
    return c.json(fail(400, '缺少 redirect 参数'), 400);
  }

  const cfg   = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);

  // 校验 SSO Server 端登录状态
  const loginId = await StpUtil.getLoginId(c.env, token);
  if (!loginId) {
    // 未登录：跳转到登录页，登录成功后再返回本 /sso/auth
    const selfUrl = new URL('/sso/auth', 'http://placeholder');
    selfUrl.searchParams.set('redirect', redirect);
    if (client) selfUrl.searchParams.set('client', client);

    const loginPageUrl = new URL('/sso/login-page', 'http://placeholder');
    loginPageUrl.searchParams.set('redirect', selfUrl.pathname + selfUrl.search);
    return c.redirect(loginPageUrl.pathname + loginPageUrl.search, 302);
  }

  // 已登录：校验 redirect URL 合法性（如有 clientId）
  if (client) {
    await ssoServer.checkRedirectUrl(c.env, redirect, client);
  }

  // 生成 ticket
  const ticket = await ssoServer.createTicket(c.env, loginId, token, client);

  // 重定向回 Client
  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set('ticket', ticket);
  return c.redirect(redirectUrl.toString(), 302);
});

/**
 * GET /sso/login-page
 * 简单的 HTML 登录页（生产环境可替换为前端项目）
 *
 * query: redirect=<after_login_url>
 */
ssoRouter.get('/login-page', (c) => {
  const redirect = c.req.query('redirect') ?? '/';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sa-Token SSO 登录</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0f2f5; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; }
    .card { background: #fff; padding: 40px; border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,.08); width: 360px; }
    h2 { text-align: center; margin-bottom: 28px; color: #1a1a2e; font-size: 22px; }
    .field { margin-bottom: 16px; }
    label { display: block; margin-bottom: 6px; color: #555; font-size: 14px; }
    input { width: 100%; padding: 10px 14px; border: 1px solid #ddd;
            border-radius: 8px; font-size: 14px; outline: none; transition: border .2s; }
    input:focus { border-color: #4a90e2; }
    button { width: 100%; padding: 12px; background: #4a90e2; color: #fff;
             border: none; border-radius: 8px; font-size: 15px; cursor: pointer;
             transition: background .2s; margin-top: 8px; }
    button:hover { background: #357abd; }
    #msg { margin-top: 14px; text-align: center; font-size: 13px; color: #e74c3c; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔐 统一身份认证</h2>
    <div class="field">
      <label>账号</label>
      <input type="text" id="loginId" placeholder="请输入账号" autocomplete="username" />
    </div>
    <div class="field">
      <label>密码</label>
      <input type="password" id="password" placeholder="请输入密码" autocomplete="current-password" />
    </div>
    <button onclick="doLogin()">登 录</button>
    <div id="msg"></div>
  </div>
  <script>
    const redirect = ${JSON.stringify(redirect)};
    async function doLogin() {
      const loginId  = document.getElementById('loginId').value.trim();
      const password = document.getElementById('password').value;
      if (!loginId) { showMsg('请输入账号'); return; }
      const resp = await fetch('/sso/do-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password })
      });
      const json = await resp.json();
      if (json.code === 200) {
        const token = json.data.tokenValue;
        localStorage.setItem('satoken', token);
        // 携带 token，重定向回 /sso/auth
        window.location.href = redirect + (redirect.includes('?') ? '&' : '?') + 'satoken=' + encodeURIComponent(token);
      } else {
        showMsg(json.msg || '登录失败');
      }
    }
    function showMsg(m) { document.getElementById('msg').textContent = m; }
    document.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  </script>
</body>
</html>`;
  return c.html(html);
});

/**
 * POST /sso/do-login
 * Server 端执行真正的登录验证。
 *
 * ⚠️  警告：此接口是演示骨架，生产环境必须实现以下内容：
 *   1. 从数据库查询用户记录
 *   2. 使用 bcrypt / argon2 等算法比对密码哈希
 *   3. 添加登录失败计数与速率限制（防暴力破解）
 *   4. 可选：二步验证（TOTP）
 * 当前实现仅用于本地开发演示，切勿直接部署到生产环境！
 *
 * body: { loginId, password }
 */
ssoRouter.post('/do-login', async (c) => {
  const body = await c.req.json<{ loginId: string; password?: string }>();

  if (!body.loginId || !body.password) {
    return c.json(fail(400, 'loginId 和 password 不能为空'), 400);
  }

  // ══════════════════════════════════════════════════════════════
  // TODO：替换以下代码为真实的数据库查询 + 密码哈希验证逻辑
  // 示例（伪代码）：
  //   const user = await db.query('SELECT * FROM users WHERE login_id = ?', [loginId]);
  //   if (!user) return c.json(fail(401, '账号或密码错误'), 401);
  //   const valid = await bcrypt.compare(password, user.passwordHash);
  //   if (!valid) return c.json(fail(401, '账号或密码错误'), 401);
  // ══════════════════════════════════════════════════════════════
  const result = await StpUtil.login(c.env, String(body.loginId));
  return c.json(ok(result));
});

/**
 * GET /sso/checkTicket
 * SSO Server 校验 ticket 接口（供 Client 调用）
 *
 * query: ticket, client?, timestamp?, nonce?, sign?
 */
ssoRouter.get('/checkTicket', async (c) => {
  const ticket = c.req.query('ticket') ?? '';
  const sign   = c.req.query('sign');

  if (!ticket) {
    return c.json(fail(SaErrorCode.CODE_20001, 'ticket 不能为空'), 400);
  }

  // 若提供签名则校验
  if (sign) {
    const params: Record<string, string> = {};
    for (const [k, v] of new URL(c.req.url).searchParams.entries()) {
      if (k !== 'sign') params[k] = v;
    }
    await ssoServer.checkSign(c.env, params, sign);
  }

  const ticketInfo = await ssoServer.checkTicket(c.env, ticket);
  return c.json(ok({ loginId: ticketInfo.loginId, loginType: ticketInfo.loginType }));
});

/**
 * GET /sso/logout
 * SSO 单点注销
 *
 * query: redirect=<callback_url>
 */
ssoRouter.get('/logout', async (c) => {
  const redirect = c.req.query('redirect') ?? '/';
  const cfg   = StpUtil.getConfig(c.env);
  const token = extractToken(c, cfg.tokenName);
  const loginId = await StpUtil.getLoginId(c.env, token);

  if (loginId) {
    await ssoServer.singleLogout(c.env, loginId);
  }

  return c.redirect(redirect, 302);
});

/**
 * POST /sso/client/register
 * 注册 SSO Client（管理接口）。
 *
 * ⚠️  生产环境：此接口必须加上鉴权保护。
 * 下面已附加 requireLogin() 中间件作为最低保障，
 * 推荐进一步使用 requireRole('admin') 仅允许管理员访问。
 *
 * body: { clientId, clientName?, allowUrls, secret }
 */
ssoRouter.post('/client/register', requireLogin(), async (c) => {
  const body = await c.req.json<{
    clientId: string;
    clientName?: string;
    allowUrls: string;
    secret: string;
  }>();

  if (!body.clientId || !body.secret) {
    return c.json(fail(400, 'clientId 和 secret 不能为空'), 400);
  }

  await ssoServer.registerClient(c.env, {
    clientId:   body.clientId,
    clientName: body.clientName ?? body.clientId,
    allowUrls:  body.allowUrls ?? '*',
    secret:     body.secret,
    isActive:   true,
  });

  return c.json(ok(null, '注册成功'));
});

// ─────────────────────────────────────────
// SSO Client 端路由
// ─────────────────────────────────────────

/**
 * GET /sso/client/login
 * Client 端：构建重定向 URL，跳转到 SSO Server 登录页
 *
 * query: redirect=<after_login_url>, clientId?
 */
ssoRouter.get('/client/login', (c) => {
  const redirect  = c.req.query('redirect')  ?? String(new URL(c.req.url).origin);
  const clientId  = c.req.query('clientId')  ?? '';

  const loginUrl = ssoClient.buildLoginUrl(c.env, redirect, clientId);
  return c.redirect(loginUrl, 302);
});

/**
 * GET /sso/client/callback
 * Client 端：SSO Server 登录成功后回调，携带 ticket 参数
 *
 * query: ticket, clientId?, redirect?
 */
ssoRouter.get('/client/callback', async (c) => {
  const ticket   = c.req.query('ticket')   ?? '';
  const clientId = c.req.query('clientId') ?? '';
  const redirect = c.req.query('redirect') ?? '/';

  if (!ticket) {
    return c.json(fail(SaErrorCode.CODE_20001, '缺少 ticket 参数'), 400);
  }

  const result = await ssoClient.checkTicket(c.env, ticket, clientId);

  // 将 token 附加在 redirect URL 后返回
  const redirectUrl = new URL(redirect, 'http://placeholder');
  redirectUrl.searchParams.set(result.tokenName, result.tokenValue);
  return c.redirect(redirectUrl.pathname + redirectUrl.search, 302);
});

/**
 * GET /sso/client/logout
 * Client 端：跳转到 SSO Server 单点注销
 *
 * query: redirect?
 */
ssoRouter.get('/client/logout', (c) => {
  const redirect = c.req.query('redirect') ?? '/';
  const logoutUrl = ssoClient.buildLogoutUrl(c.env, redirect);
  return c.redirect(logoutUrl, 302);
});

// ─────────────────────────────────────────
// 维护接口
// ─────────────────────────────────────────

/**
 * POST /sso/clean-expired
 * 清理过期 ticket（可由 Cron Trigger 定时调用）
 */
ssoRouter.post('/clean-expired', async (c) => {
  await ssoServer.cleanExpired(c.env);
  return c.json(ok(null, '清理完成'));
});

// 错误处理
ssoRouter.onError((err, c) => {
  if (err instanceof SaSsoException || err instanceof SaTokenException) {
    return c.json(fail(err.code, err.message), 400);
  }
  console.error('[sso]', err);
  return c.json(fail(500, '服务器内部错误'), 500);
});

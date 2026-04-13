/**
 * Sa-Token Cloudflare Worker — 主入口
 *
 * 使用 Hono 框架，挂载所有路由，并配置全局错误处理和 CORS。
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth.js';
import { ssoRouter }  from './routes/sso.js';
import { cleanExpiredTokenSessions } from './dao/D1Dao.js';
import { ok } from './config.js';
import type { Env } from './types.js';

const app = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────
// 全局中间件
// ─────────────────────────────────────────

// CORS — 生产环境请将 origin: '*' 替换为具体域名列表，例如：
// cors({ origin: ['https://app.example.com', 'https://admin.example.com'], ... })
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'satoken'],
  exposeHeaders: ['satoken'],
}));

// ─────────────────────────────────────────
// 健康检查
// ─────────────────────────────────────────
app.get('/', (c) => c.json(ok({ name: 'sa-token-cf-worker', version: '1.0.0' })));
app.get('/health', (c) => c.json(ok({ status: 'ok', timestamp: Date.now() })));

// ─────────────────────────────────────────
// 路由挂载
// ─────────────────────────────────────────
app.route('/auth', authRouter);
app.route('/sso',  ssoRouter);

// ─────────────────────────────────────────
// 全局错误处理
// ─────────────────────────────────────────
app.onError((err, c) => {
  console.error('[global]', err);
  return c.json({ code: 500, msg: '服务器内部错误', data: null }, 500);
});

app.notFound((c) => c.json({ code: 404, msg: '接口不存在', data: null }, 404));

// ─────────────────────────────────────────
// Cloudflare Workers 导出
// ─────────────────────────────────────────
export default {
  /**
   * 处理 HTTP 请求
   */
  fetch: app.fetch,

  /**
   * Scheduled（Cron Trigger）— 定时清理过期数据
   *
   * 在 wrangler.toml 中配置：
   *   [triggers]
   *   crons = ["0 2 * * *"]   # 每天 02:00 UTC 执行
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[cron] 开始清理过期 token 会话...');
    await cleanExpiredTokenSessions(env.DB);
    console.log('[cron] 清理完成');
  },
};

# Sa-Token Cloudflare Workers

将 Sa-Token 核心认证功能移植到 **Cloudflare Workers + D1** 的 TypeScript 实现。

- 运行时：Cloudflare Workers（零冷启动、全球边缘节点）
- 持久化：Cloudflare D1（SQLite）
- 缓存：Cloudflare KV（Token 快速查找）
- 框架：[Hono](https://hono.dev/)（轻量 Web 框架）

---

## 功能清单

| 模块 | 功能 |
|------|------|
| 登录认证 | 登录 / 注销 / 踢人下线 / 顶号下线 |
| Token 管理 | UUID / Random 多种风格，KV 快速校验 + D1 持久化 |
| Session | 账号级 key-value 存储 |
| 权限认证 | 权限列表增删查、权限校验 |
| 角色认证 | 角色列表增删查、角色校验 |
| 账号封禁 | 分类封禁 / 阶梯封禁 / 解封 / 封禁查询 |
| SSO Server | 生成/校验 ticket、单点注销、Client 注册 |
| SSO Client | 跳转登录 / 回调校验 / 单点注销 |
| 临时 Token | 短时一次性授权 token |
| 中间件 | requireLogin / requirePermission / requireRole |
| 定时清理 | Cron Trigger 自动清理过期 token / ticket |

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create sa-token-db
```

将命令输出的 `database_id` 填入 `wrangler.toml`：
```toml
[[d1_databases]]
binding = "DB"
database_name = "sa-token-db"
database_id = "<your-database-id>"
```

### 3. 创建 KV 命名空间

```bash
wrangler kv namespace create TOKEN_KV
```

将 `id` 填入 `wrangler.toml`：
```toml
[[kv_namespaces]]
binding = "TOKEN_KV"
id = "<your-kv-namespace-id>"
```

### 4. 初始化数据库表结构

```bash
# 本地开发
npm run db:migrate

# 部署到生产
npm run db:migrate:remote
```

### 5. 修改配置（可选）

编辑 `wrangler.toml` 的 `[vars]` 区域，按需调整 token 有效期、SSO 密钥等参数。

> **重要**：生产环境请将 `SSO_SECRET_KEY` 改为高强度随机字符串，并通过 `wrangler secret put SSO_SECRET_KEY` 设置为 Workers Secret，避免明文暴露。

### 6. 本地开发

```bash
npm run dev
```

### 7. 部署

```bash
npm run deploy
```

---

## API 文档

### 认证接口（`/auth`）

#### 登录
```http
POST /auth/login
Content-Type: application/json

{ "loginId": "10001", "device": "default", "timeout": 3600 }
```

响应：
```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "loginId": "10001",
    "tokenName": "satoken",
    "tokenValue": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "isLogin": true,
    "loginType": "login",
    "tokenTimeout": 3600
  }
}
```

#### 注销
```http
POST /auth/logout
satoken: <token>
```

#### 踢人下线
```http
POST /auth/kickout
Content-Type: application/json

{ "loginId": "10001" }
```

#### 查询 Token 信息
```http
GET /auth/token-info
satoken: <token>
```

#### 权限管理
```http
# 添加权限
POST /auth/permission/add
{ "loginId": "10001", "permission": "user:add" }

# 删除权限
POST /auth/permission/remove
{ "loginId": "10001", "permission": "user:add" }

# 获取权限列表
GET /auth/permission/10001

# 校验权限
POST /auth/permission/check
{ "loginId": "10001", "permission": "user:add" }
```

#### 账号封禁
```http
# 封禁（banCategory 为分类，可选；disableTime 为秒数，-1 永久）
POST /auth/disable
{ "loginId": "10001", "banCategory": "comment", "banLevel": 1, "disableTime": 86400, "reason": "发表违规内容" }

# 解封
POST /auth/untie-disable
{ "loginId": "10001", "banCategory": "comment" }

# 查询封禁信息
GET /auth/disable-info/10001?banCategory=comment
```

#### 临时 Token
```http
# 创建（timeout 单位：秒）
POST /auth/temp-token/create
{ "service": "download", "value": "/files/report.pdf", "timeout": 300 }

# 解析
GET /auth/temp-token/parse?token=xxx&service=download
```

---

### SSO 接口（`/sso`）

Sa-Token CF Worker 同时支持 **SSO Server** 和 **SSO Client** 两种角色：
- `SSO_SERVER_URL` 为空 → 本实例充当 SSO Server
- `SSO_SERVER_URL` 有值 → 本实例充当 SSO Client

#### SSO Server

| 接口 | 说明 |
|------|------|
| `GET /sso/auth?redirect=<url>&client=<id>` | 认证入口，未登录时跳转登录页 |
| `GET /sso/login-page?redirect=<url>` | 内置登录页面（可替换为自定义前端） |
| `POST /sso/do-login` | 执行登录验证（需替换为真实业务逻辑） |
| `GET /sso/checkTicket?ticket=xxx` | 校验 ticket（Client 调用） |
| `GET /sso/logout?redirect=<url>` | 单点注销 |
| `POST /sso/client/register` | 注册 SSO Client |

#### SSO Client

| 接口 | 说明 |
|------|------|
| `GET /sso/client/login?redirect=<url>` | 跳转到 SSO Server 登录 |
| `GET /sso/client/callback?ticket=xxx` | 登录成功回调，校验 ticket 建立本地会话 |
| `GET /sso/client/logout?redirect=<url>` | 跳转到 SSO Server 单点注销 |

#### SSO 典型流程

```
用户访问 Client 受保护页面
  → GET /sso/client/login?redirect=https://client.com/dashboard
  → 302 跳转到 SSO Server: /sso/auth?redirect=https://client.com/sso/client/callback&client=client1
  → 用户在 Server 登录页输入账号密码
  → POST /sso/do-login → 登录成功，生成 ticket
  → 302 跳转回 Client: https://client.com/sso/client/callback?ticket=xxxx
  → Client 调用 Server /sso/checkTicket 校验 ticket
  → 校验通过，建立本地 session，302 跳转到 /dashboard
```

---

## 中间件使用

```typescript
import { requireLogin, requirePermission, requireRole } from './src/middleware/auth';
import { Hono } from 'hono';

const api = new Hono();

// 要求登录
api.get('/profile', requireLogin(), async (c) => {
  const loginId = c.get('loginId');
  return c.json({ loginId });
});

// 要求权限
api.post('/user', requirePermission('user:add'), async (c) => {
  // ...
});

// 要求角色
api.get('/admin', requireRole('admin'), async (c) => {
  // ...
});
```

---

## 多账号体系

Sa-Token 支持多套账号体系（如普通用户 / 管理员），通过 `loginType` 区分：

```http
# 管理员登录（loginType = admin）
POST /auth/login
{ "loginId": "admin001", "loginType": "admin" }

# 校验管理员权限
POST /auth/permission/check
{ "loginId": "admin001", "permission": "sys:manage", "loginType": "admin" }
```

---

## 定时清理（Cron Trigger）

在 `wrangler.toml` 中添加：

```toml
[triggers]
crons = ["0 2 * * *"]
```

Worker 会在每天 UTC 02:00 自动清理过期的 token 会话和 SSO ticket。

---

## 项目结构

```
sa-token-cf-worker/
├── src/
│   ├── index.ts              # Worker 入口
│   ├── types.ts              # 类型定义 & 异常类
│   ├── config.ts             # 配置 & 工具函数
│   ├── core/
│   │   ├── StpLogic.ts       # 核心认证逻辑（对标 Java StpLogic）
│   │   ├── SaSession.ts      # 账号 Session
│   │   └── SaTempToken.ts    # 临时 Token
│   ├── dao/
│   │   └── D1Dao.ts          # D1 数据访问层
│   ├── sso/
│   │   ├── SaSsoServer.ts    # SSO 服务端
│   │   └── SaSsoClient.ts    # SSO 客户端
│   ├── routes/
│   │   ├── auth.ts           # 认证 REST API
│   │   └── sso.ts            # SSO REST API
│   └── middleware/
│       └── auth.ts           # Hono 中间件工厂
├── schema.sql                # D1 建表脚本
├── wrangler.toml             # Cloudflare 配置
├── package.json
└── tsconfig.json
```

---

## 与 Java 版 Sa-Token 对照

| Java 版 | CF Worker 版 |
|---------|-------------|
| `StpUtil.login(id)` | `StpUtil.login(env, id)` |
| `StpUtil.checkLogin()` | `StpUtil.checkLogin(env, token)` |
| `StpUtil.getLoginId()` | `StpUtil.getLoginId(env, token)` |
| `StpUtil.logout()` | `StpUtil.logoutByToken(env, token)` |
| `StpUtil.kickout(id)` | `StpUtil.kickoutByLoginId(env, id)` |
| `StpUtil.checkPermission(p)` | `StpUtil.checkPermission(env, loginId, p)` |
| `StpUtil.disable(id, time)` | `StpUtil.disable(env, id, '', 1, time)` |
| `SaSession.set(k, v)` | `session.set(k, v)` |
| Redis DAO | D1 DAO + KV 缓存 |
| Spring Boot Starter | Hono 路由 |
| `@SaCheckLogin` 注解 | `requireLogin()` 中间件 |

---

## 注意事项

1. **`/sso/do-login` 密码验证**：演示实现未做真实密码校验，生产环境务必替换为查询数据库 + 密码哈希比对。
2. **SSO Secret Key**：生产环境通过 `wrangler secret put SSO_SECRET_KEY` 设置，不要在 `wrangler.toml` 明文填写。
3. **CORS**：默认 `origin: '*'`，生产环境按需限制为具体域名。
4. **管理接口保护**：`/sso/client/register` 等管理接口，生产环境应加上鉴权保护（如 `requireRole('admin')` 中间件）。

# AeroPre_Auth_center

> 基于 **Cloudflare Workers + D1 + KV** 的轻量级统一身份认证中心，零服务器、全球边缘部署。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.12-orange?logo=hono)](https://hono.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

---

## 功能特性

| 模块 | 功能 |
|------|------|
| 🔐 登录认证 | 登录 / 注销 / 踢人下线 / 顶号下线 |
| 🪙 Token 管理 | UUID / Random 多种风格，KV 快速校验 + D1 持久化双层存储 |
| 📦 Session | 账号级 key-value 存储 |
| 🛡️ 权限认证 | 权限列表增删查、权限校验 |
| 👤 角色认证 | 角色列表增删查、角色校验 |
| 🚫 账号封禁 | 分类封禁 / 阶梯封禁 / 解封 / 封禁查询 |
| 🔗 SSO Server | 生成/校验 ticket、单点注销、Client 注册 |
| 🔗 SSO Client | 跳转登录 / 回调校验 / 单点注销 |
| ⏱️ 临时 Token | 短时一次性授权 token |
| 🧩 中间件 | `requireLogin` / `requirePermission` / `requireRole` |
| 🕒 定时清理 | Cron Trigger 自动清理过期 token / ticket |

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| Web 框架 | [Hono v4.12](https://hono.dev/) |
| 持久化 | Cloudflare D1（SQLite） |
| 缓存 | Cloudflare KV |
| 语言 | TypeScript 5.x |

---

## 快速开始

### 前置要求

- Node.js 18+
- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
- Wrangler CLI（随 `devDependencies` 安装，无需全局安装）

---

### 第一步：克隆并安装依赖

```bash
git clone https://github.com/zxy7906052/sso.git
cd sso
npm install
```

---

### 第二步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会自动打开授权页面，完成后返回终端继续操作。

---

### 第三步：创建 D1 数据库

```bash
npx wrangler d1 create aeropre-auth-center-db
```

命令成功后会输出类似：

```
✅ Successfully created DB 'aeropre-auth-center-db'
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**将 `uuid` 值填入 `wrangler.toml`：**

```toml
[[d1_databases]]
binding = "DB"
database_name = "aeropre-auth-center-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← 填入此处
```

---

### 第四步：创建 KV 命名空间

```bash
npx wrangler kv namespace create TOKEN_KV
```

输出示例：

```
✅ Successfully created namespace 'aeropre-auth-center-TOKEN_KV'
{ "id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" }
```

**将 `id` 填入 `wrangler.toml`：**

```toml
[[kv_namespaces]]
binding = "TOKEN_KV"
id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"   # ← 填入此处
```

---

### 第五步：初始化数据库表结构

**本地开发环境：**

```bash
npm run db:migrate
```

**生产/远程 D1：**

```bash
npm run db:migrate:remote
```

---

### 第六步：设置生产环境密钥

> ⚠️ 不要将密钥明文写入 `wrangler.toml`，请使用 Wrangler Secret：

```bash
npx wrangler secret put SSO_SECRET_KEY
# 按提示输入一个高强度随机字符串（建议 64 位以上）
```

---

### 第七步：本地开发

```bash
npm run dev
```

Worker 将在 `http://localhost:8787` 启动，支持热重载。

---

### 第八步：部署到 Cloudflare

```bash
npm run deploy
```

部署成功后会输出 Worker 的公开访问地址，例如：

```
https://aeropre-auth-center.your-subdomain.workers.dev
```

---

## 环境变量说明

所有变量在 `wrangler.toml` 的 `[vars]` 区域配置：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SA_TOKEN_NAME` | Token 在 Header / Cookie 中的 key 名 | `satoken` |
| `SA_TOKEN_TIMEOUT` | Token 默认有效期（秒），`-1` = 永不过期 | `2592000`（30天）|
| `SA_TOKEN_ACTIVE_TIMEOUT` | 活跃有效期（秒），`-1` = 不启用 | `1800`（30分钟）|
| `SA_TOKEN_IS_CONCURRENT` | 是否允许同端并发登录 | `true` |
| `SA_TOKEN_IS_SHARE` | 并发登录时是否复用同一 Token | `true` |
| `SA_TOKEN_MAX_LOGIN_COUNT` | 最大同端登录数，`-1` = 不限制 | `12` |
| `SSO_SERVER_URL` | SSO 服务端地址（充当 SSO Client 时填写） | 空 |
| `SSO_SECRET_KEY` | SSO 签名密钥（**生产环境用 Secret**） | — |
| `SSO_TICKET_TIMEOUT` | ticket 有效期（秒） | `300` |

---

## API 文档

所有接口统一返回格式：

```json
{ "code": 200, "msg": "ok", "data": { ... } }
```

---

### 认证接口 `/auth`

#### 登录

```http
POST /auth/login
Content-Type: application/json

{
  "loginId": "10001",
  "device": "default",
  "timeout": 3600,
  "extra": { "username": "张三" }
}
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

后续请求在 Header 中携带 Token：

```http
satoken: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

#### 注销

```http
POST /auth/logout
satoken: <token>
```

---

#### 踢人下线

```http
POST /auth/kickout
Content-Type: application/json

{ "loginId": "10001" }
```

---

#### 查询 Token 信息

```http
GET /auth/token-info
satoken: <token>
```

---

#### 判断是否登录

```http
GET /auth/is-login
satoken: <token>
```

---

#### 权限管理

```http
# 添加权限
POST /auth/permission/add
{ "loginId": "10001", "permission": "user:add" }

# 移除权限
POST /auth/permission/remove
{ "loginId": "10001", "permission": "user:add" }

# 获取权限列表
GET /auth/permission/10001

# 校验权限
POST /auth/permission/check
{ "loginId": "10001", "permission": "user:add" }
```

---

#### 角色管理

```http
# 添加角色
POST /auth/role/add
{ "loginId": "10001", "role": "admin" }

# 移除角色
POST /auth/role/remove
{ "loginId": "10001", "role": "admin" }

# 获取角色列表
GET /auth/role/10001

# 校验角色
POST /auth/role/check
{ "loginId": "10001", "role": "admin" }
```

---

#### 账号封禁

```http
# 封禁（banCategory 为封禁分类，disableTime 为秒数，-1 = 永久）
POST /auth/disable
{
  "loginId": "10001",
  "banCategory": "comment",
  "banLevel": 1,
  "disableTime": 86400,
  "reason": "违规操作"
}

# 解封
POST /auth/untie-disable
{ "loginId": "10001", "banCategory": "comment" }

# 查询封禁信息
GET /auth/disable-info/10001?banCategory=comment
```

---

#### 临时 Token

```http
# 创建（timeout 单位：秒）
POST /auth/temp-token/create
{ "service": "download", "value": "/files/report.pdf", "timeout": 300 }

# 解析
GET /auth/temp-token/parse?token=xxx&service=download
```

---

### SSO 接口 `/sso`

AeroPre_Auth_center 可同时充当 **SSO Server** 和 **SSO Client**：

- `SSO_SERVER_URL` 为空 → 当前实例是 **SSO Server**
- `SSO_SERVER_URL` 有值 → 当前实例是 **SSO Client**

#### SSO 登录完整流程

```
用户访问 Client 受保护页面
  ↓
GET /sso/client/login?redirect=https://client.com/dashboard
  ↓
302 → SSO Server: /sso/auth?redirect=https://client.com/sso/client/callback&client=client1
  ↓
用户在 Server 登录页输入账号
  ↓
POST /sso/do-login → 生成 ticket
  ↓
302 → Client: https://client.com/sso/client/callback?ticket=xxxx
  ↓
Client 调用 Server /sso/checkTicket 校验 ticket
  ↓
校验通过，建立本地 session，302 → /dashboard
```

---

#### SSO Server 接口

| 接口 | 说明 |
|------|------|
| `GET /sso/auth?redirect=<url>&client=<id>` | 认证入口，未登录跳登录页 |
| `GET /sso/login-page?redirect=<url>` | 内置登录页（可替换为自定义前端）|
| `POST /sso/do-login` | 执行登录验证 ⚠️ 需实现密码校验 |
| `GET /sso/checkTicket?ticket=xxx` | 校验 ticket（供 Client 调用）|
| `GET /sso/logout?redirect=<url>` | 单点注销 |
| `POST /sso/client/register` | 注册 SSO Client（需登录）|

---

#### SSO Client 接口

| 接口 | 说明 |
|------|------|
| `GET /sso/client/login?redirect=<url>` | 跳转到 SSO Server 登录 |
| `GET /sso/client/callback?ticket=xxx` | 登录成功回调，建立本地会话 |
| `GET /sso/client/logout?redirect=<url>` | 跳转到 SSO Server 单点注销 |

---

## 中间件使用

```typescript
import { requireLogin, requirePermission, requireRole } from './middleware/auth.js';
import { Hono } from 'hono';

const api = new Hono();

// 要求登录
api.get('/profile', requireLogin(), async (c) => {
  const loginId = c.get('loginId');
  return c.json({ loginId });
});

// 要求权限
api.post('/article', requirePermission('article:publish'), async (c) => {
  // ...
});

// 要求角色
api.get('/admin', requireRole('admin'), async (c) => {
  // ...
});
```

---

## 多账号体系

通过 `loginType` 区分不同账号表（如普通用户与管理员）：

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

Worker 将在每天 UTC 02:00 自动清理过期 token 会话和 SSO ticket。

---

## 项目结构

```
.
├── src/
│   ├── index.ts              # Worker 入口 + Cron Trigger
│   ├── types.ts              # 类型定义 & 异常类
│   ├── config.ts             # 配置读取 & 工具函数
│   ├── core/
│   │   ├── StpLogic.ts       # 核心认证逻辑
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
│       └── auth.ts           # Hono 鉴权中间件
├── schema.sql                # D1 建表脚本
├── wrangler.toml             # Cloudflare 配置
├── package.json
└── tsconfig.json
```

---

## 生产部署注意事项

1. **`/sso/do-login` 密码验证**：默认实现为演示骨架，生产必须替换为真实的数据库查询 + 密码哈希（bcrypt / argon2）验证。

2. **SSO Secret Key**：通过 `wrangler secret put SSO_SECRET_KEY` 设置，不要在 `wrangler.toml` 中明文填写。

3. **CORS**：`src/index.ts` 中默认为 `origin: '*'`，生产按需改为具体域名：
   ```typescript
   cors({ origin: ['https://app.example.com'] })
   ```

4. **`/sso/client/register`**：已加 `requireLogin()` 保护，建议进一步限制为 `requireRole('admin')`。

5. **速率限制**：生产建议在登录接口前添加 Cloudflare Rate Limiting 规则，防止暴力破解。

---

## License

[Apache 2.0](LICENSE)

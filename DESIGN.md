# FiveAvenues 文旅网站 — 设计文档

> 最后更新：2026-07-14

## 1. 项目概述

**FiveAvenues（五大道旅行文化指南）** 是一个基于本地 WuDaDao 历史知识库的文旅网站，为游客提供天津五大道的个性化行程生成与社区评价功能。

- **技术栈**：Node.js 原生 HTTP（无框架、零 npm 依赖）
- **运行环境**：Node.js >= 18
- **启动方式**：`cd app && npm start` → http://localhost:3000

## 2. 功能架构

```
┌─────────────────────────────────────────────────┐
│                  前端 (public/)                   │
│  ┌──────────┬──────────┬────────────┬──────────┐ │
│  │定制行程  │游客 Wiki │  我的评价  │审核后台 │ │
│  └──────────┴──────────┴────────────┴──────────┘ │
│                    ↕ app.js                       │
├─────────────────────────────────────────────────┤
│              静态资源 (public/)                   │
│  index.html / styles.css                         │
├─────────────────────────────────────────────────┤
│              后端 (server.js)                     │
│  ┌──────────────┬──────────────┬───────────────┐ │
│  │ 行程 API     │ 账号 API     │ 评价 API      │ │
│  │ /api/meta    │ /api/auth/   │ /api/reviews  │ │
│  │ /api/guide   │ register     │ /api/my-reviews││
│  │ /api/reload  │ login/logout │ /api/admin/   │ │
│  └──────────────┴──────────────┴───────────────┘ │
│                    ↕ src/                         │
├─────────────────────────────────────────────────┤
│              业务模块 (src/)                      │
│  store.js │ auth.js │ reviews.js │ generator.js │
│  data.js  │ wiki.js │ recommender.js │ frontmatter.js
├─────────────────────────────────────────────────┤
│              数据存储 (data/)                     │
│  shops.json │ activities.json │ feedback.json    │
│  reviews.json │ users.json                           │
│  WuDaDao/ (历史知识库 Markdown)                    │
└─────────────────────────────────────────────────┘
```

## 3. 路由一览

### 3.1 静态资源

| 路径 | 内容 |
|---|---|
| `/` | index.html |
| `/app.js` | 前端逻辑 |
| `/styles.css` | 样式 |

### 3.2 行程 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 元数据：兴趣、目的、店铺/活动列表、知识库数量 |
| POST | `/api/guide` | 生成个性化行程（接受 purposeId, interests[], startDate, endDate） |
| POST | `/api/reload` | 重新加载 WuDaDao 知识库 |

### 3.3 账号 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（自动登录） |
| POST | `/api/auth/login` | 登录（返回 Set-Cookie） |
| POST | `/api/auth/logout` | 登出（清除 Cookie） |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 3.4 游客 Wiki 评价 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reviews` | 公开列表（仅已通过评价，可选 ?targetType=&targetId= 过滤） |
| POST | `/api/reviews` | 提交评价（无需登录，支持匿名） |
| GET | `/api/my-reviews` | 我的评价（需登录，返回全部状态含 pending/rejected） |

### 3.5 管理员审核 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/reviews` | 管理员列表（需登录+admin 角色，可选 ?status=pending|approved|rejected） |
| GET | `/api/admin/reviews/:id` | 单条评价详情 |
| POST | `/api/admin/reviews/:id/moderate` | 审核操作 `{action:"approve"\|"reject", note?"..."}` |

## 4. 数据模型

### 4.1 用户 (`users.json`)

```json
{
  "id": "uuid",
  "username": "string (2-24 chars)",
  "password": "salt:scryptHash",
  "role": "visitor | admin",
  "createdAt": "ISO-8601"
}
```

### 4.2 评价 (`reviews.json`)

```json
{
  "id": "uuid",
  "rating": 1-5,
  "title": "string (optional)",
  "body": "string (1-2000 chars)",
  "tags": ["string"],
  "targetType": "overall | shop | activity",
  "targetId": "string or null",
  "targetName": "string or null",
  "authorId": "uuid or null (匿名时为 null)",
  "authorName": "string (实名用户名 or '匿名游客')",
  "anonymous": boolean,
  "status": "pending | approved | rejected",
  "createdAt": "ISO-8601",
  "reviewedAt": "ISO-8601 or null",
  "reviewedBy": "uuid or null",
  "moderationNote": "string or null"
}
```

### 4.3 会话

- Cookie 名：`fa_session`
- 格式：内存中 token → userId 映射
- 有效期：7 天
- 属性：HttpOnly, SameSite=Lax, Path=/

## 5. 安全设计

| 措施 | 说明 |
|---|---|
| 密码哈希 | scrypt (N=16384, r=8, p=1)，每用户独立 salt |
| 会话隔离 | HttpOnly Cookie，跨站请求不携带（SameSite=Lax） |
| 权限校验 | 管理员接口分两级：401 未登录、403 非管理员 |
| 内容清洗 | 评价 body/title 转义 HTML 特殊字符（esc()） |
| 数据保护 | `users.json` / `reviews.json` 在 `.gitignore` 中 |

## 6. 前端架构

### 6.1 视图

| 视图 ID | 路由按钮 | 访问条件 |
|---|---|---|
| `view-guide` | 定制行程 | 所有人 |
| `view-wiki` | 游客 Wiki | 所有人 |
| `view-my-reviews` | 我的评价 | 仅登录用户 |
| `view-admin` | 审核后台 | 仅管理员 |

### 6.2 组件

- **评分星标**：5 星，hover 预览，click 确认
- **评价表单**：评分 + 对象下拉 + 标题 + 正文 + 标签 + 匿名复选框
- **评价墙**：卡片列表，显示评分条、目标、正文、作者、日期
- **我的评价**：卡片列表 + 审核状态徽章 + 拒绝意见展示
- **审核后台**：分类筛选 Tab + 卡片列表 + 通过/拒绝按钮 + 拒绝备注输入

### 6.3 弹窗

- 登录/注册弹窗：ESC 关闭、点击遮罩关闭、× 按钮关闭
- 输入框 Enter 键快捷提交

## 7. 模块职责

| 模块 | 职责 |
|---|---|
| `store.js` | 原子 JSON 数组存储（写临时文件 + rename，写操作串行队列） |
| `auth.js` | 注册、登录、登出、session token、密码验证、管理员初始化 |
| `reviews.js` | 创建评价、公开列表（过滤 approved）、管理员列表、审核操作、统计 |
| `generator.js` | 行程生成算法（排名、日期解析、季节性） |
| `recommender.js` | 用户意图→wiki 标签映射、评分排序、日期重叠处理 |
| `wiki.js` | Markdown 知识库加载（frontmatter 解析） |
| `data.js` | shops/activities/feedback JSON 加载与归一化 |
| `frontmatter.js` | YAML frontmatter 解析器 |

## 8. 部署

### 8.1 开发

```bash
cd app
npm start
```

### 8.2 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 监听端口 | `3000` |
| `ADMIN_USER` | 管理员用户名 | `admin` |
| `ADMIN_PASS` | 管理员密码 | `admin12345` |

### 8.3 生产注意事项

- 当前为内存会话，多实例部署需改用 Redis 或数据库
- 密码哈希使用 scrypt（Node 内置），生产环境建议调整 N/r/p 参数
- 静态文件无 CDN，生产建议前置反向代理（Nginx/Caddy）

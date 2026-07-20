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
| GET | `/api/meta` | 元数据：兴趣、目的、店铺/活动列表、知识库数量、**RAG 降级字段**（`ragAvailable` / `ragUnavailableReason` / `ragConfigGuide` / `ragIndexExists`）、`reportReasons` |
| POST | `/api/guide` | 生成个性化行程（接受 purposeId, interests[], startDate, endDate）；响应含 `rag`（是否 RAG 生成）与 `ragDegraded`（已配密钥/索引缺失或生成失败时降级标志，绝不返回 500） |
| POST | `/api/analytics` | 埋点接收端（T-M.2/3）：服务端经 `ANALYTICS_ENDPOINT` 转发；未配置则 no-op；失败静默 |
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
| GET | `/api/reviews` | 公开列表（仅已通过评价，按 `helpfulCount` 降序 + 时间倒序；可选 ?targetType=&targetId= 过滤） |
| POST | `/api/reviews` | 提交评价（需登录；登录用户可勾选匿名） |
| POST | `/api/reviews/:id/helpful` | 切换「有用」投票（需登录；仅已通过评价可投，同用户去重，再次点击取消） |
| POST | `/api/reviews/:id/report` | 提交举报（需登录；`{reason}` 非空，同用户同评价 10 分钟内去重；返回 201） |
| GET | `/api/my-reviews` | 我的评价（需登录，返回全部状态含 pending/rejected） |

### 3.5 管理员审核 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/reviews` | 管理员列表（需登录+admin 角色，可选 ?status=pending\|approved\|rejected） |
| GET | `/api/admin/reviews/:id` | 单条评价详情 |
| POST | `/api/admin/reviews/:id/moderate` | 审核操作 `{action:"approve"\|"reject", note?"..."}` |
| POST | `/api/admin/reviews/batch` | 批量审核 `{ids:[...], action:"approve"\|"reject"}`（单条失败进入 `failed[]`，不中断整批，响应 `{succeeded:[], failed:[]}`） |
| GET | `/api/admin/reports` | 举报工单列表（富化 `reviewTitle` / `reviewStatus` / `reviewExcerpt` / `reviewFlagged`，可选 ?status=） |
| GET | `/api/admin/reports/:id` | 举报工单详情 |
| POST | `/api/admin/reports/:id/resolve` | 处理举报 `{decision:"uphold"\|"dismiss", note?}`；`dismiss` 自动下架对应评价（`moderate(reject)`） |

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
  "helpfulCount": "integer (已投「有用」计数)",
  "helpfulBy": ["uuid (投票用户 id，仅服务端可见)"],
  "flagged": "boolean (body/title 命中敏感词预检)",
  "createdAt": "ISO-8601",
  "reviewedAt": "ISO-8601 or null",
  "reviewedBy": "uuid or null",
  "moderationNote": "string or null"
}
```

### 4.3 举报工单 (`reports.json`)

> 新增于 V1.2（FR-12 / FR-13）。与 `reviews.json` 同属运行期数据，已在 `.gitignore` 中。

```json
{
  "id": "uuid",
  "reviewId": "uuid (被举报评价)",
  "reason": "string (原因分类文本，如 垃圾广告/不实信息/不当内容/骚扰/其他)",
  "reporterId": "uuid (仅管理员可见)",
  "reporterName": "string (仅管理员可见)",
  "status": "pending | resolved | dismissed",
  "createdAt": "ISO-8601",
  "resolvedAt": "ISO-8601 or null",
  "resolvedBy": "string or null",
  "decision": "uphold | dismiss | null",
  "resolveNote": "string or null"
}
```

> `resolved` = 采纳举报并下架评价（`decision:"dismiss"`）；`dismissed` = 驳回举报、维持评价（`decision:"uphold"`）。

### 4.4 会话

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
| `reviews.js` | 创建评价、公开列表（过滤 approved，按 `helpfulCount` 排序）、管理员列表、审核操作、批量审核、有用投票 toggle、敏感词预检 |
| `reports.js` | 举报工单创建（10 分钟去重）、列表、统计、处理（dismiss 自动下架对应评价） |
| `analytics.js` | 埋点双写（服务端经 `ANALYTICS_ENDPOINT` 转发；未配置则 no-op，失败静默） |
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
| `WUDADAO_KB_PATH` | 外部 WuDaDao 知识库目录（FR-8）；绝对路径或 `file://` URL，留空则使用仓库内默认 `WuDaDao/` | 空（回退默认） |
| `ANALYTICS_ENDPOINT` | 埋点上报端点（NFR-8 / T-M.2/3）；**未配置则 `/api/analytics` 静默 no-op**，不影响主流程 | 空（关闭埋点） |

### 8.3 生产注意事项

- 当前为内存会话，多实例部署需改用 Redis 或数据库
- 密码哈希使用 scrypt（Node 内置），生产环境建议调整 N/r/p 参数
- 静态文件无 CDN，生产建议前置反向代理（Nginx/Caddy）

## 9. RAG（检索增强生成）模块

> 目标：在 WuDaDao 知识库之上，用向量检索 + 大模型生成个性化行程，作为规则化 `generator.js` 的增强与兜底替代。

### 9.1 设计原则
- **零依赖**：沿用 NFR-1。Embedding / 对话均通过 Node 18 全局 `fetch` 调用 HTTP API，不引入任何 npm 包；向量检索用预建 JSON 索引 + 纯 JS 余弦相似度，不引向量库。
- **契约不变**：RAG 产出与 `/api/guide` 原有结构完全同构（`meta / overview / itinerary / history / architecture / shops / eventCalendar / seasonal / sources`），前端 `app.js` 的 `renderGuide()` 零改动。
- **优雅降级**：未配置 `RAG_API_KEY`、索引缺失、模型不可用或输出非法时，自动回退到规则化 `buildGuide()`，网站永远有输出。

### 9.2 目录（`app/rag/`）
| 文件 | 职责 |
|---|---|
| `chunk.js` | 复用 `wiki.js` 解析结果，把页面切成带元数据的重叠语料块 |
| `embed.js` | 调 Embedding / 对话补全（fetch，支持智谱 / DeepSeek / OpenAI 等 OpenAI 兼容服务）|
| `retrieve.js` | 运行时余弦检索 top-K（纯 JS）|
| `generate.js` | 检索 → 构造 prompt → 调大模型 → 解析校验为 guide 对象 |
| `index.js` | 离线建库脚本：`node app/rag/index.js` 生成 `app/data/rag-index.json`（依据 `WUDADAO_KB_PATH` 读取知识库）|
| `build.js` | 复用的建库函数 `buildRagIndex()`；`index.js` 与运行时 `/api/reload` 共用，确保离线/在线读取同一配置路径 |

### 9.3 配置（`.env`，已被 gitignore）
| 变量 | 说明 | 默认 |
|---|---|---|
| `RAG_API_KEY` | 服务商密钥；**未配置则全程降级到规则生成** | 空 |
| `RAG_BASE_URL` | API Base（智谱 `https://open.bigmodel.cn/api/paas/v4`）| 智谱 |
| `RAG_EMBED_MODEL` | 向量模型（embedding-3，2048 维）| `embedding-3` |
| `RAG_LLM_MODEL` | 对话模型（glm-4-flash 等）| `glm-4-flash` |

### 9.4 使用
1. 准备 WuDaDao 知识库（仓库外目录，见 §2 / §7）。
2. 复制 `.env.example` 为 `.env`，填入 `WUDADAO_KB_PATH`（指向外部知识库目录）与 `RAG_API_KEY`（可选）。
3. 建索引：`npm run rag:index`（或 `node app/rag/index.js`）。
4. 启动：`npm start`。前端「定制行程」勾选「AI 增强生成（RAG）」即可。
5. 运行中点「↻ 同步」会依据当前 `.env` 配置重新加载知识库，并在已配 `RAG_API_KEY` 时异步重建向量索引。

> **知识库可达性（FR-8）**：`WUDADAO_KB_PATH` 未配置时回退仓库内默认 `WuDaDao/`；目录不存在 / 无读权限时，行程生成降级到本地 `data/*.json` 规则生成（不静默失败），`/api/meta` 返回 `wikiStatus: "degraded"` 与错误原因，前端顶栏同步按钮旁显示「⚠ 知识库不可用」。

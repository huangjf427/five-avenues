# FiveAvenues · 五大道旅行文化指南

> 为天津五大道景区游客提供 **个性化行程生成** 与 **社区评价分享** 的一站式文旅指南网站。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Version](https://img.shields.io/badge/version-V1.2-9cf)](./REQUIREMENTS.md)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-success)](./app/package.json)

---

## 功能亮点

- **个性化行程生成** — 基于本地 WuDaDao 历史知识库，输入旅行目的与兴趣，自动生成逐日行程、历史人物、建筑风貌、美食推荐与节事日历
- **RAG 智能增强（可选）** — 接入大模型，向量检索 + AI 生成，行程更精准、内容更丰富；未配置密钥时自动退化为规则生成
- **游客 Wiki 社区** — 评价分享、有用投票、举报机制，审核先行确保内容质量
- **管理员审核后台** — 评价审核、举报处理、批量操作、敏感词预检
- **零 npm 依赖** — 纯 Node.js 内置模块实现，极致轻量

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- 无需安装任何 npm 包

### 1. 克隆仓库

```bash
git clone https://github.com/huangjf427/five-avenues.git
cd five-avenues
```

### 2. 配置环境变量（可选）

```bash
cp .env.example .env
```

按需编辑 `.env`：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `ADMIN_USER` | 管理员用户名 | `admin` |
| `ADMIN_PASS` | 管理员密码 | `admin12345` |
| `WUDADAO_KB_PATH` | 外部 WuDaDao 知识库路径（留空使用仓库默认） | 空 |
| `RAG_API_KEY` | RAG 大模型密钥（留空则关闭 AI 增强） | 空 |
| `RAG_BASE_URL` | RAG API 地址 | 智谱 PaaS v4 |
| `RAG_LLM_MODEL` | 对话模型 | `glm-4-flash` |

### 3. 启动服务

```bash
cd app
npm start
```

浏览器打开 **http://localhost:3000** 即可使用。

### 4. 启用 RAG AI 增强（可选）

```bash
# 1. 在 .env 中配置 RAG_API_KEY
# 2. 构建向量索引
npm run rag:index
# 3. 重启服务，前端勾选「AI 增强生成（RAG）」即可
```

---

## 项目结构

```
five-avenues/
├── app/
│   ├── server.js              # HTTP 服务入口
│   ├── package.json           # 项目配置与脚本
│   ├── public/                # 前端静态资源
│   │   ├── index.html         # 单页应用（4 个视图）
│   │   ├── app.js             # 前端逻辑
│   │   └── styles.css         # 样式（含响应式）
│   ├── src/                   # 后端业务模块（零依赖）
│   │   ├── auth.js            # 账号管理（scrypt 密码哈希）
│   │   ├── reviews.js         # 评价 CRUD + 审核 + 投票
│   │   ├── reports.js         # 举报工单管理
│   │   ├── analytics.js       # 埋点上报模块
│   │   ├── generator.js       # 规则行程生成
│   │   ├── recommender.js     # 兴趣匹配与排序
│   │   ├── wiki.js            # 知识库加载与解析
│   │   ├── data.js            # 本地数据加载
│   │   ├── store.js           # 原子 JSON 存储
│   │   └── frontmatter.js     # YAML frontmatter 解析
│   ├── rag/                   # RAG 检索增强生成（零依赖）
│   │   ├── chunk.js           # 语料切片
│   │   ├── embed.js           # Embedding / 对话 API
│   │   ├── retrieve.js        # 余弦相似度检索
│   │   ├── generate.js        # RAG 行程生成
│   │   ├── index.js           # 离线建库脚本
│   │   └── build.js           # 建库函数
│   └── data/                  # 本地数据源
│       ├── shops.json         # 商铺数据
│       ├── activities.json    # 活动数据
│       ├── feedback.json      # 反馈数据（排序加权）
│       └── README.md          # 数据说明
├── docs/                      # 项目文档
│   ├── PRD_V1.2_RAG社区增强.md
│   ├── V1.2_研发任务拆解.md
│   ├── FiveAvenues项目管理流程.md
│   ├── FiveAvenues竞品分析报告.md
│   ├── competitive-analysis/  # 竞品分析过程文档
│   └── initial-draft/         # 用户手册 / 运维手册（初稿）
├── rag Design/                # RAG 早期概念文档（已过时归档）
├── .env.example               # 环境变量模板
├── .gitignore
├── REQUIREMENTS.md            # 需求文档
├── DESIGN.md                  # 设计文档
└── stage1-test-cases.md       # 测试用例
```

---

## API 概览

### 行程

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/meta` | 元数据（兴趣/目的/RAG 状态/知识库状态） |
| POST | `/api/guide` | 生成个性化行程（支持 RAG 增强） |
| POST | `/api/reload` | 重新加载知识库并重建 RAG 索引 |

### 账号

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（自动登录） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 获取当前用户 |

### 评价

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reviews` | 公开评价列表（仅已通过） |
| POST | `/api/reviews` | 提交评价（需登录） |
| POST | `/api/reviews/:id/helpful` | 切换有用投票 |
| POST | `/api/reviews/:id/report` | 举报评价 |
| GET | `/api/my-reviews` | 我的评价 |

### 管理员

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/reviews` | 评价管理列表 |
| POST | `/api/admin/reviews/:id/moderate` | 审核评价 |
| POST | `/api/admin/reviews/batch` | 批量审核 |
| GET | `/api/admin/reports` | 举报工单列表 |
| POST | `/api/admin/reports/:id/resolve` | 处理举报 |

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 需求文档（FR-1~FR-13 + NFR-1~NFR-8） |
| [DESIGN.md](./DESIGN.md) | 设计文档（架构/路由/数据模型/安全） |
| [stage1-test-cases.md](./stage1-test-cases.md) | 测试用例（70+ 条，含回归/权限/边界） |
| [docs/PRD_V1.2_RAG社区增强.md](./docs/PRD_V1.2_RAG社区增强.md) | V1.2 PRD |
| [docs/V1.2_研发任务拆解.md](./docs/V1.2_研发任务拆解.md) | V1.2 研发任务分解 |
| [app/data/README.md](./app/data/README.md) | 本地数据源格式说明 |
| [项目完整性审核报告.md](./项目完整性审核报告.md) | 代码审核报告 |

---

## 技术特色

- **零依赖** — 仅使用 Node.js 内置模块（`http`、`fs`、`crypto`、`path`、`url`），不引入任何 npm 包
- **纯 JS 向量检索** — 余弦相似度暴力检索，无需 Chroma/Pinecone 等向量数据库
- **优雅降级** — 知识库不可达 → 本地数据兜底；RAG 失败 → 规则生成兜底；埋点失败 → 静默丢弃
- **安全设计** — scrypt 加盐密码哈希、HttpOnly Cookie、权限分级（401/403）、内容转义
- **响应式** — 桌面/移动端自适应；支持打印/导出 PDF

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request。详细需求与设计请参阅 [REQUIREMENTS.md](./REQUIREMENTS.md) 和 [DESIGN.md](./DESIGN.md)。

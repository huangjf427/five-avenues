# 阶段一测试用例 — FiveAvenues 五大道文旅指南（RAG 增强）

> 阶段：阶段一 · 测试准备
> 起草依据：`rag Design/` 需求文档 + 仓库根 `REQUIREMENTS.md` / `DESIGN.md` + 实际实现代码（`app/`）
> 关联工作项：阶段一测试准备（1.1 测试计划 / 1.2 测试用例 / 1.3 测试执行 `rURh2k`）
> 关联 Bug：登录越权 `rUMPYp`（提交 `3216ed6`）、硬编码 Windows 路径 `rUYZWZ`（已暂停）

---

## 0. 测试计划

| 项 | 内容 |
| --- | --- |
| **测试目标** | 验证 FiveAvenues V1.0 已上线功能（FR-1~FR-7）在测试环境下的正确性、健壮性与权限隔离；验证 RAG 增强模块（检索增强生成）的「增强可用 + 全程优雅降级」契约；回归登录越权修复（3216ed6）。 |
| **测试范围** | 行程生成（规则 + RAG）、账号、游客 Wiki 评价（发布/展示/审核/我的评价）、知识库同步、前端视图与权限隔离、非功能（安全/响应式/可打印）。 |
| **不在范围** | 知识库内容本身的正确性（属 PO/内容 owner 职责）；增量更新、权限多用户等 P2 未实现项（见 §1 范围澄清）。 |
| **测试环境** | Node.js ≥ 18；`cd app && npm start` → http://localhost:3000；测试数据 `app/data/{shops,activities,feedback}.json`；`reviews.json` / `users.json` 初始为空（已被 `.gitignore`）。 |
| **RAG 测试前置** | 复制 `.env.example` 为 `.env`，填入 `RAG_API_KEY`；`npm run rag:index`（或 `node app/rag/index.js`）生成 `app/data/rag-index.json`。未配置密钥时全程降级，无需索引。 |
| **测试账号** | 管理员默认 `admin / admin12345`（可由 `ADMIN_USER` / `ADMIN_PASS` 覆盖）；普通用户测试时自行注册。 |
| **验收标准** | 所有 P0 用例（FR-1~FR-4、FR-6）通过；RAG「增强」与「降级」两条路径均验证；全部权限用例（401/403/界面隔离）通过；登录越权 14 条回归全过；无 S1/S2 未解决项。 |
| **风险提示** | ① 匿名发表 API 缺口；② 硬编码 Windows 路径（`rUYZWZ` 已暂停）；③ 内存会话重启即失效；④ `rag Design/` 需求文档与实现不一致（已闭环，详见 §1）。 |

---

## 1. 需求溯源与范围澄清（重要）

用户要求「基于 `rag Design/` 需求文档」起草。经核对，`rag Design/` 目录下实际存在的文档为概念/规划类：

| `rag Design/` 文档 | 内容 | 与实现的关系 |
| --- | --- | --- |
| `RAG知识库Wiki_需求规划.md` | RAG 知识库**内部 Wiki** 规划，Python 栈（LangChain/Chroma/bge），P0/P1/P2 功能范围 | **概念源头**。PO 已确认其 Python 技术选型为**过时文档**，实际以 `app/rag/*`（Node.js）实现为准。功能范围被落地为「RAG 增强行程生成」而非独立内部 Wiki。 |
| `README.md` / `rag_intro.md` / `product_flow.md` | RAG 简介、六阶段流程、快速开始（Python 脚本） | 同上，指导性。**实际运行形态见 `DESIGN.md` §9（Node.js 零依赖）。** |
| `requirements.txt` | Python 依赖清单 | **已确认过时**，不作为测试或实现依据。 |
| `产品需求全流程工作清单.md` / `notes.txt` | 通用 SOP / 待办 | 流程参考，无具体功能断言。 |

> **结论**：`rag Design/` 提供 RAG「检索增强生成」的能力范围（加载→解析→切片→向量化→检索→生成→展示）作为**需求意图**，而**可测的产品实现**集中在仓库根的 `REQUIREMENTS.md`（FR-1~FR-7）与 `DESIGN.md`。本用例同时锚定二者，并在 RAG 专项（§3.2）直接对应 `rag Design/` 的功能范围。

### 需求→实现映射表

| `rag Design/` 功能范围 | 实际落地 | 需求编号 | 测试章节 |
| --- | --- | --- | --- |
| 知识库加载/解析（md 等） | `wiki.js` 加载 WuDaDao Markdown + frontmatter | FR-1 约束① | §3.1 / §3.6 |
| 切片与向量化 | `rag/chunk.js` + `rag/embed.js`（离线建索引） | RAG 专项 | §3.2 |
| 检索与生成（RAG pipeline） | `rag/retrieve.js` + `rag/generate.js` | FR-1 增强 | §3.2 |
| Wiki 生成 / 搜索问答界面 | 前端「定制行程」勾选「AI 增强生成（RAG）」 | FR-1 | §3.1 / §3.2 |
| 语义检索（游客 Wiki） | 评价检索/过滤（`/api/reviews?targetType=`） | FR-3 | §3.4 |
| 增量更新 / 权限多用户 | **未实现**（P2，已确认当前不需要） | — | 不在范围 |

---

## 2. 测试用例总览（六类场景）

> 用例编号规则：`TC-<模块>-<序号>`
> 模块：G=行程生成 / R=RAG 专项 / RV=评价发布展示 / AD=审核 / MR=我的评价 / AU=账号 / P=权限隔离 / C=兼容 / REG=回归
> 场景类型：正常 / 边界 / 异常 / 权限 / 兼容 / 回归
> 优先级：P0（阻断验收）/ P1（重要）/ P2（补充）

| 编号 | 模块 | 场景 | 标题 | 优先级 | 关联需求 |
| --- | --- | --- | --- | --- | --- |
| TC-G-01 | 行程 | 正常 | 默认参数生成行程 | P0 | FR-1 |
| TC-G-02 | 行程 | 正常 | 指定日期范围生成 | P0 | FR-1 |
| TC-G-03 | 行程 | 边界 | 结束早于开始（自动交换） | P1 | FR-1 |
| TC-G-04 | 行程 | 正常 | 多兴趣影响排名 | P1 | FR-1 |
| TC-G-05 | 行程 | 正常 | RAG 增强生成（含索引+密钥） | P0 | FR-1/RAG |
| TC-G-06 | 行程 | 边界 | 超长日期范围（>14 天截断） | P1 | FR-1 |
| TC-G-07 | 行程 | 边界 | 兴趣超 5 项传入 | P2 | FR-1 |
| TC-G-08 | 行程 | 边界 | 空兴趣数组（用默认） | P1 | FR-1 |
| TC-G-09 | 行程 | 边界 | 未知/缺失 purposeId（默认 leisure） | P1 | FR-1 |
| TC-G-10 | 行程 | 边界 | 知识库为空/缺页 | P2 | FR-1 |
| TC-G-11 | 行程 | 异常 | RAG 生成失败自动降级 | P0 | FR-1/NFR 降级 |
| TC-G-12 | 行程 | 异常 | 非法 JSON body | P2 | 健壮性 |
| TC-R-01 | RAG | 正常 | 未配置密钥 → meta.ragEnabled=false | P0 | DESIGN §9 |
| TC-R-02 | RAG | 边界 | 有密钥无索引 → 降级规则 | P0 | DESIGN §9 |
| TC-R-03 | RAG | 边界 | 索引为空（chunks=[]）→ 降级 | P1 | generate.js |
| TC-R-04 | RAG | 异常 | LLM 输出非 JSON → 降级 | P1 | generate.js |
| TC-R-05 | RAG | 异常 | LLM 缺字段（validate 失败）→ 降级 | P1 | generate.js |
| TC-R-06 | RAG | 正常 | 建索引后无需重启即生效 | P2 | server.js |
| TC-R-07 | RAG | 异常 | 建库脚本无密钥 → exit(2) | P2 | index.js |
| TC-RV-01 | 评价 | 正常 | 已登录用户发表评价 | P0 | FR-2 |
| TC-RV-02 | 评价 | 权限 | 游客（未登录）发表评价 | **P0** | FR-2/PO 决策 ⚠️ |
| TC-RV-03 | 评价 | 边界 | 评分边界（0/6/小数/非数字） | P0 | FR-2 |
| TC-RV-04 | 评价 | 边界 | 正文最小长度（4/5 字） | P0 | FR-2 |
| TC-RV-05 | 评价 | 边界 | 正文超 2000 字截断 | P1 | reviews.js |
| TC-RV-06 | 评价 | 边界 | 标题超 80 / 空标题 | P1 | reviews.js |
| TC-RV-07 | 评价 | 边界 | 标签超过 6 个 / 单标签超 20 字 | P1 | reviews.js |
| TC-RV-08 | 评价 | 边界 | targetType 非法值 → 默认 overall | P1 | reviews.js |
| TC-RV-09 | 评价 | 边界 | 已登录勾选匿名 | P1 | FR-2 |
| TC-RV-10 | 评价 | 正常 | 公开列表仅 approved 且倒序 | P0 | FR-3 |
| TC-RV-11 | 评价 | 正常 | 按 targetType / targetId 过滤 | P1 | FR-3 |
| TC-RV-12 | 评价 | 正常 | 匿名展示「匿名游客」不泄露 id | P0 | FR-3/NFR-4 |
| TC-RV-13 | 评价 | 正常 | 公共列表不含 pending/rejected/内部字段 | P0 | FR-3/NFR-4 |
| TC-RV-14 | 评价 | 异常 | 缺 body / rating → 400 | P0 | FR-2 |
| TC-RV-15 | 评价 | 异常 | HTML/JS 注入转义（esc） | P0 | NFR-4 |
| TC-AD-01 | 审核 | 权限 | 未登录访问 → 401 | P0 | FR-4 |
| TC-AD-02 | 审核 | 权限 | 普通用户访问 → 403 | P0 | FR-4 |
| TC-AD-03 | 审核 | 权限 | 管理员访问 → 200 + counts | P0 | FR-4 |
| TC-AD-04 | 审核 | 正常 | 通过（approve）记录操作人/时间 | P0 | FR-4 |
| TC-AD-05 | 审核 | 正常 | 拒绝（reject + 备注） | P0 | FR-4 |
| TC-AD-06 | 审核 | 正常 | 按 status 筛选 | P1 | FR-4 |
| TC-AD-07 | 审核 | 正常 | 详情接口 / 不存在 → error | P1 | FR-4 |
| TC-AD-08 | 审核 | 正常 | 已通过⇄已拒绝 互相切换 | P1 | FR-4 |
| TC-AD-09 | 审核 | 异常 | 无效 action（如 delete）→ 400 | P1 | reviews.js |
| TC-AD-10 | 审核 | 异常 | 审核不存在 id → 400 | P1 | reviews.js |
| TC-MR-01 | 我的 | 权限 | 未登录访问 → 401 | P0 | FR-5 |
| TC-MR-02 | 我的 | 正常 | 已登录仅见本人评价（含全部状态） | P0 | FR-5 |
| TC-MR-03 | 我的 | 正常 | 显示审核状态徽章 + 拒绝意见 | P1 | FR-5 |
| TC-MR-04 | 我的 | 正常 | 不出现他人评价 | P1 | FR-5 |
| TC-AU-01 | 账号 | 正常 | 注册（2–24 字符 + 密码≥6）→ 201+自动登录 | P0 | FR-6 |
| TC-AU-02 | 账号 | 正常 | 登录正确 → 200 + Set-Cookie | P0 | FR-6 |
| TC-AU-03 | 账号 | 边界 | 用户名 <2 或 >24 → 400 | P0 | FR-6 |
| TC-AU-04 | 账号 | 边界 | 用户名含非法字符（空格/@）→ 400 | P1 | FR-6 |
| TC-AU-05 | 账号 | 边界 | 密码 <6 → 400 | P0 | FR-6 |
| TC-AU-06 | 账号 | 异常 | 重复用户名 → 400 | P0 | FR-6 |
| TC-AU-07 | 账号 | 异常 | 错误密码 → 401 | P0 | FR-6 |
| TC-AU-08 | 账号 | 异常 | 不存在用户 → 401 | P0 | FR-6 |
| TC-AU-09 | 账号 | 正常 | 登出 → 清除 Cookie | P0 | FR-6 |
| TC-AU-10 | 账号 | 正常 | /auth/me 登录态/未登录态 | P1 | FR-6 |
| TC-AU-11 | 账号 | 边界 | 会话 7 天过期 → 失效 | P2 | FR-6 |
| TC-AU-12 | 账号 | 边界 | 用户名大小写不敏感 | P1 | auth.js |
| TC-AU-13 | 账号 | 正常 | ensureAdmin 默认/环境变量覆盖 | P1 | DESIGN §8 |
| TC-SEC-01 | 安全 | 安全 | 密码非明文（salt:scrypt 哈希） | P0 | NFR-4 |
| TC-SEC-02 | 安全 | 安全 | Cookie HttpOnly + SameSite=Lax + Path=/ | P0 | NFR-4 |
| TC-SEC-03 | 安全 | 边界 | 内存会话重启即清空 | P2 | DESIGN §8 |
| TC-SEC-04 | 安全 | 安全 | 硬编码 Windows 路径（D:\workspace\WuDaDao） | P1 | Bug rUYZWZ ⚠️ |
| TC-P-01 | 权限 | 权限 | 游客态：我的评价/审核后台不可见 | P0 | 关联 rUMPYp |
| TC-P-02 | 权限 | 权限 | 普通用户：可见我的评价，不可见审核后台 | P0 | 关联 rUMPYp |
| TC-P-03 | 权限 | 权限 | 管理员：两者均可见 | P0 | 关联 rUMPYp |
| TC-C-01 | 兼容 | 兼容 | 桌面/移动响应式（单列折叠） | P1 | NFR-5 |
| TC-C-02 | 兼容 | 兼容 | 打印/导出 PDF 隐藏表单与导航 | P1 | NFR-6 |
| TC-C-03 | 兼容 | 兼容 | 主流浏览器核心流程 | P2 | NFR-5 |
| TC-REG-01~14 | 回归 | 回归 | 登录越权修复 14 条回归 | P0 | 3216ed6 / regression-login-fix.md |

---

## 3. 详细用例

### 3.1 行程生成（FR-1，规则 + RAG）

**TC-G-01 默认参数生成行程（正常 / P0）**
- 前置：服务启动，知识库与本地数据就绪。
- 步骤：`POST /api/guide`，body `{}`（无 purposeId / interests / 日期）。
- 期望：200；返回对象含 `meta / overview / itinerary / history / architecture / shops / eventCalendar / seasonal / sources`；`meta.days=2`、`dateLabel` 含「默认 2 日行程」；`guide.rag=false`（无密钥时）。

**TC-G-02 指定日期范围生成（正常 / P0）**
- 步骤：`POST /api/guide` `{"purposeId":"research","interests":["history","beiyang"],"startDate":"2026-10-01","endDate":"2026-10-03"}`。
- 期望：200；`meta.days=3`、`seasonLabel="秋季"`、`meta.purposeLabel="深度历史研学"`；`interestLabels` 含「近代历史」「北洋军政」。

**TC-G-03 结束早于开始（边界 / P1）**
- 步骤：`startDate="2026-10-05"`、`endDate="2026-10-01"`。
- 期望：不报错；自动交换后 `days=5`，结果与正序一致。

**TC-G-04 多兴趣影响排名（正常 / P1）**
- 步骤：分别用 `["food"]` 与 `["architecture"]` 生成，对比 `itinerary`/`shops` 排序差异。
- 期望：兴趣命中越高，相关点位/商铺排名越靠前（与 `recommender.js` 加权一致）。

**TC-G-05 RAG 增强生成（正常 / P0）**
- 前置：已配置 `RAG_API_KEY` 且 `app/data/rag-index.json` 存在。
- 步骤：`POST /api/guide` `{"useRag":true,"purposeId":"leisure","interests":["architecture"]}`。
- 期望：200；`guide.rag=true`；`sources` 来自检索命中的知识库页（非模型编造外链）；其余字段满足 `validate()` 契约。

**TC-G-06 超长日期范围（边界 / P1）**
- 步骤：`startDate` 与 `endDate` 相差 30 天。
- 期望：`meta.days` 截断为 **14**（代码 `Math.min(14, …)`）；不超时/不报错。

**TC-G-07 兴趣超 5 项传入（边界 / P2）**
- 步骤：传入 6 个 interests。
- 期望：记录实际行为（前端限制最多 5，API 不强制；若后端未截断，需标注为一致性观察项）。

**TC-G-08 空兴趣数组（边界 / P1）**
- 步骤：`interests:[]`。
- 期望：不报错；以默认「五大道历史人文」生成，`interestLabels=[]`，`meta.interestLabels=[]`。

**TC-G-09 未知/缺失 purposeId（边界 / P1）**
- 步骤：`purposeId:"unknown"` 或省略。
- 期望：`purposeById` 回退 `PURPOSES[0]`（休闲观光），**不崩溃**，返回 200。

**TC-G-10 知识库为空/缺页（边界 / P2）**
- 步骤：临时移除 WuDaDao 知识库后生成。
- 期望：返回 200（降级文案），或记录错误响应（依 wiki 加载行为定）。

**TC-G-11 RAG 生成失败自动降级（异常 / P0）**
- 前置：有密钥+索引，但临时让 LLM 返回 500 或非法。
- 步骤：触发 RAG 路径失败后观察。
- 期望：`server.js` 捕获异常并回退 `buildGuide()`，返回 200 且 `guide.rag=false`，**不返回 500**（EARS：任何一步失败都应降级而非报错）。

**TC-G-12 非法 JSON body（异常 / P2）**
- 步骤：`POST /api/guide` 发送非 JSON 文本。
- 期望：`readBody` 解析失败回退 `{}`，返回 200 默认行程（与 TC-G-01 同）。

---

### 3.2 RAG 专项（`rag Design/` 检索增强生成范围 + DESIGN §9）

**TC-R-01 未配置密钥（正常 / P0）**
- 步骤：无 `.env` / 无 `RAG_API_KEY`；`GET /api/meta` 与 `POST /api/guide {useRag:true}`。
- 期望：`meta.ragEnabled=false`；`/api/guide` 忽略 `useRag`，走规则生成，`rag=false`。

**TC-R-02 有密钥无索引（边界 / P0）**
- 步骤：配置密钥但未运行 `rag:index`；`useRag:true`。
- 期望：`getRagIndex()` 返回 null → 降级规则生成，`rag=false`，不报错。

**TC-R-03 索引为空（边界 / P1）**
- 步骤：构造 `rag-index.json` 为 `{"chunks":[]}`；`useRag:true`。
- 期望：`buildGuideRag` 抛「RAG 索引为空」→ 降级规则。

**TC-R-04 LLM 输出非 JSON（异常 / P1）**
- 步骤：让 `chat()` 返回纯文本。
- 期望：`JSON.parse` 失败 → 抛错 → 降级规则。

**TC-R-05 LLM 缺字段（异常 / P1）**
- 步骤：让 `chat()` 返回缺 `overview` 或 `itinerary` 的 JSON。
- 期望：`validate()` 抛错 → 降级规则。

**TC-R-06 建索引后无需重启（正常 / P2）**
- 步骤：服务运行中执行 `rag:index` 重建索引；再次 `useRag:true`。
- 期望：新索引被惰性加载并生效（`ragIndexLoading` 失败重试逻辑）；无需重启。

**TC-R-07 建库脚本无密钥（异常 / P2）**
- 步骤：清空 `RAG_API_KEY` 后 `node app/rag/index.js`。
- 期望：打印提示并以 `exit(2)` 退出，不产生损坏索引。

---

### 3.3 评价发布与展示（FR-2 / FR-3）

**TC-RV-01 已登录用户发表评价（正常 / P0）**
- 步骤：登录后 `POST /api/reviews` `{"rating":5,"targetType":"shop","targetId":"<id>","title":"很棒","body":"体验非常好非常满意","tags":["咖啡"]}`。
- 期望：201；`review.status="pending"`；`authorName=<用户名>`、`anonymous=false`、`authorId` 非空；提示「审核通过后公开展示」。

**TC-RV-02 游客（未登录）发表评价（权限 / P0）⚠️**
- 步骤：不携带 Cookie，`POST /api/reviews` 同上。
- 期望（现状）：`createReview` 中 `anonymous = !user` 为真 → 仍创建 **pending 匿名评价**，`authorName="匿名游客"`。
- ⚠️ **风险关注**：PO 在 3216ed6 已确认「必须登录后才能发表」，且前端已隐藏写评价表单（`#reviewFormPanel`）；但 **API 层未强制登录**，仍可匿名提交。建议研发在 API 层（如 `server.js` 的 `POST /api/reviews`）加登录校验，与前端行为及 PO 决策对齐。本条按「现状行为」记录，并作为 **缺陷候选** 提报。

**TC-RV-03 评分边界（边界 / P0）**
- 步骤：分别传 `rating=0 / 6 / 3.7 / "abc" / 空`。
- 期望：`clampRating` → `0→null→400「请给出 1–5 的评分」`；`6→5`；`3.7→四舍五入=4`；`"abc"→null→400`；缺 rating→400。

**TC-RV-04 正文最小长度（边界 / P0）**
- 步骤：`body` 为 4 字 / 5 字。
- 期望：4 字 → 400「评价内容至少 5 个字」；5 字 → 通过。

**TC-RV-05 正文超长（边界 / P1）**
- 步骤：`body` 长度 2500。
- 期望：`clean(body, 2000)` 截断为 2000 字，201。

**TC-RV-06 标题边界（边界 / P1）**
- 步骤：`title` 长度 100 / 空。
- 期望：>80 截断为 80；空 title → `title:""`。

**TC-RV-07 标签边界（边界 / P1）**
- 步骤：`tags` 传 8 个；单标签 30 字。
- 期望：截断前 6 个；单标签截断 20 字；空标签被 `filter(Boolean)` 丢弃。

**TC-RV-08 targetType 非法（边界 / P1）**
- 步骤：`targetType:"xxx"`。
- 期望：回退 `overall`，`targetId` 被忽略（不写入）。

**TC-RV-09 已登录勾选匿名（边界 / P1）**
- 步骤：登录后 `anonymous:true`。
- 期望：`authorName="匿名游客"`、`authorId=null`、`anonymous=true`。

**TC-RV-10 公开列表（正常 / P0）**
- 步骤：`GET /api/reviews`。
- 期望：200；仅含 `status="approved"`；按 `createdAt` 倒序。

**TC-RV-11 过滤（正常 / P1）**
- 步骤：`GET /api/reviews?targetType=shop&targetId=<id>`。
- 期望：仅返回匹配对象的 approved 评价。

**TC-RV-12 匿名展示（正常 / P0）**
- 步骤：查看一条匿名 approved 评价。
- 期望：`authorName="匿名游客"`；**不含** `authorId`。

**TC-RV-13 公共列表字段裁剪（正常 / P0）**
- 期望：`toPublic()` 投影不含 `authorId / reviewedAt / reviewedBy / moderationNote` 等内部字段；无 pending/rejected 泄漏。

**TC-RV-14 缺字段（异常 / P0）**
- 步骤：缺 `body` 或 `rating`。
- 期望：400，对应错误信息。

**TC-RV-15 内容注入转义（异常 / P0）**
- 步骤：`body:"<script>alert(1)</script>"` 或含 HTML 特殊字符。
- 期望：存储/展示经 `esc()` 转义，前端不执行脚本（NFR-4 内容清洗）。

---

### 3.4 审核管理（FR-4）

**TC-AD-01 未登录访问（权限 / P0）**：`GET /api/admin/reviews` 无 Cookie → **401**「请先登录」。
**TC-AD-02 普通用户访问（权限 / P0）**：普通用户 Cookie → **403**「需要管理员权限」。
**TC-AD-03 管理员访问（权限 / P0）**：管理员 Cookie → 200，含 `items` 与 `counts{pending,approved,rejected}`。
**TC-AD-04 通过（正常 / P0）**：`POST /api/admin/reviews/:id/moderate` `{"action":"approve"}` → 200 `status=approved`，`reviewedAt/reviewedBy` 已记录；随后该评价出现在公共列表。
**TC-AD-05 拒绝+备注（正常 / P0）**：`{"action":"reject","note":"含广告"}` → `status=rejected`、`moderationNote="含广告"`；不出现在公共列表。
**TC-AD-06 按状态筛选（正常 / P1）**：`?status=pending|approved|rejected` 分别返回对应集合。
**TC-AD-07 详情/不存在（正常 / P1）**：`GET /api/admin/reviews/:id` 返回完整记录；不存在 id → `{error:"评价不存在"}`。
**TC-AD-08 状态互切（正常 / P1）**：approved 改 rejected、rejected 改 approved 均可成功。
**TC-AD-09 无效 action（异常 / P1）**：`{"action":"delete"}` → 400「无效的审核操作」。
**TC-AD-10 不存在 id 审核（异常 / P1）**：`moderate` 不存在 id → 400「评价不存在」。

---

### 3.5 我的评价（FR-5）

**TC-MR-01 未登录（权限 / P0）**：`GET /api/my-reviews` 无 Cookie → **401**。
**TC-MR-02 已登录本人（正常 / P0）**：返回仅 `authorId===当前用户` 的评价，含 pending/approved/rejected 全部状态，倒序。
**TC-MR-03 状态展示（正常 / P1）**：前端正确显示 ⏳/✅/❌ 徽章；rejected 显示 `moderationNote`。
**TC-MR-04 隔离（正常 / P1）**：另一用户评价不出现在本人的「我的评价」中。

---

### 3.6 账号管理（FR-6）

**TC-AU-01 注册（正常 / P0）**：`POST /api/auth/register` `{"username":"测试员","password":"abc123"}` → 201 且 `Set-Cookie`，`user.role="visitor"`，自动登录。
**TC-AU-02 登录（正常 / P0）**：正确账号 → 200 + `Set-Cookie`。
**TC-AU-03 用户名长度（边界 / P0）**：1 字或 25 字 → 400「用户名需为 2–24 位…」。
**TC-AU-04 非法字符（边界 / P1）**：含空格/`@`/中文标点 → 400（`USERNAME_RE` 仅允许字母数字下划线中文）。
**TC-AU-05 密码长度（边界 / P0）**：5 位 → 400「密码至少 6 位」。
**TC-AU-06 重复注册（异常 / P0）**：同名 → 400「用户名已被注册」（大小写不敏感）。
**TC-AU-07 错误密码（异常 / P0）**：→ 401「用户名或密码错误」。
**TC-AU-08 不存在用户（异常 / P0）**：→ 401。
**TC-AU-09 登出（正常 / P0）**：`POST /api/auth/logout` → 200，`Set-Cookie` 设 `Max-Age=0`，后续请求视为未登录。
**TC-AU-10 当前用户（正常 / P1）**：`GET /api/auth/me` 登录态返回 `user`；未登录返回 `user:null`。
**TC-AU-11 会话过期（边界 / P2）**：模拟 token 超过 7 天 → `userFromToken` 返回 null（测试可临时调小 `SESSION_TTL_MS` 验证）。
**TC-AU-12 大小写不敏感（边界 / P1）**：注册 `Abc` 后可用 `abc` 登录成功。
**TC-AU-13 管理员初始化（正常 / P1）**：首次启动 `ensureAdmin` 建 `admin/admin12345`；设 `ADMIN_USER/ADMIN_PASS` 则覆盖。

---

### 3.7 安全与兼容性（NFR）

**TC-SEC-01 密码哈希（P0）**：检查 `users.json` 中密码为 `salt:scryptHash` 形式，无明文。
**TC-SEC-02 Cookie 属性（P0）**：`Set-Cookie` 含 `HttpOnly; SameSite=Lax; Path=/; Max-Age=…`。
**TC-SEC-03 内存会话（边界 / P2）**：重启服务后旧 session 失效、需重新登录/重建 admin —— **测试环境注意项**。
**TC-SEC-04 硬编码路径（P1）⚠️**：`server.js` 启动日志 `Wiki source: D:\workspace\WuDaDao` 为硬编码 Windows 路径 → 非 Windows 环境知识库加载失败。关联暂停 Bug `rUYZWZ`，不阻塞功能验证但阻塞跨平台上线。
**TC-C-01 响应式（P1）**：窄屏下网格折叠为单列（NFR-5）。
**TC-C-02 可打印（P1）**：`@media print` 下隐藏表单与导航，可导出 PDF（NFR-6）。
**TC-C-03 浏览器兼容（P2）**：Chrome/Edge/Safari/Firefox 完成核心流程冒烟。

---

### 3.8 回归范围（关联 3216ed6 / `regression-login-fix.md`）

| 编号 | 标题 | 期望 |
| --- | --- | --- |
| REG-01 | 任意 `hidden` 元素不可见 | 无 `display` 覆盖残留（A1） |
| REG-02 | 游客态「我的评价」按钮不可见 | B1 |
| REG-03 | 游客态「我的评价」面板不可见 | B2 |
| REG-04 | 游客态「审核后台」不可见 | B3 |
| REG-05 | Wiki 评价区显示登录引导、隐藏写表单 | B4 |
| REG-06 | 未登录调用 `showView('my-reviews')` 跳回 guide | B5（纵深防御） |
| REG-07 | 非管理员调用 `showView('admin')` 跳回 guide | B6（纵深防御） |
| REG-08 | 普通用户可见我的评价、不可见审核后台 | C1 |
| REG-09 | 普通用户可发表评价（可选匿名） | C2 |
| REG-10 | 管理员可见审核后台并可进入 | D1 |
| REG-11 | 管理员可见我的评价 | D2 |
| REG-12 | `!important` 未破坏 flex/导航高亮 | E1 |
| REG-13 | 登录/登出后可见性状态正确刷新 | E2 |
| REG-14 | PO 决策闭环确认 | 必须登录才能发表；Python 文档过时已关闭 |

> 完整步骤见 `regression-login-fix.md`。REG-14 已闭环，但 **TC-RV-02** 指出的「API 仍接受匿名提交」需研发补齐，否则 REG-05 仅为前端假隔离。

---

## 4. 测试执行清单（勾选表）

- [ ] **P0 行程**：TC-G-01/02/05/11
- [ ] **P0 RAG 降级**：TC-R-01/02
- [ ] **P0 评价**：TC-RV-01/03/04/10/12/13/14/15
- [ ] **P0 审核权限**：TC-AD-01/02/03/04/05
- [ ] **P0 我的评价**：TC-MR-01/02
- [ ] **P0 账号**：TC-AU-01/02/03/05/06/07/08/09
- [ ] **P0 安全**：TC-SEC-01/02
- [ ] **P0 权限隔离**：TC-P-01/02/03
- [ ] **P0 回归**：REG-01~14
- [ ] **P1/P2 补充**：其余边界/异常/兼容用例
- [ ] **风险闭环**：TC-RV-02（API 匿名缺口）、TC-SEC-04（硬编码路径 `rUYZWZ`）

---

## 5. 风险关注点（提报测试负责人）

1. **匿名发表 API 缺口（高）**：前端已按 PO 决策隐藏写评价表单（必须登录），但 `POST /api/reviews` 未强制登录，仍接受匿名提交。建议研发在 API 层加登录校验，否则 REG-05 仅为前端假隔离，存在越权/垃圾内容风险。**提报为缺陷候选，关联 rUMPYp。**
2. **硬编码 Windows 路径（中，已暂停）**：`server.js` 日志硬编码 `D:\workspace\WuDaDao`，非 Windows 环境知识库加载失败。关联暂停 Bug `rUYZWZ`，需排期改为可配置路径。
3. **内存会话（低）**：重启即失效，影响「7 天免登录」体验与测试可重复性；多实例部署需 Redis/DB（DESIGN §8）。
4. **需求文档不一致（已闭环）**：`rag Design/requirements.txt` Python 栈与 `rag Design/` 内部 Wiki 规划为过时文档，实际为 `app/rag/*` Node.js 实现。PO 已确认关闭；建议更新/补充 `rag Design/` 文档以匹配实际产品定位，避免后续误解。

---

*下一步建议：将本文档上传至项目资料库「测试用例」目录，并基于 §4 清单创建测试执行事项分配给测试同学（关联工作项 1.3 `rURh2k`）。*

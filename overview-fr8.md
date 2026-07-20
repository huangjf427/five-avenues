# PRD 1.1 (FR-8) 交付总结 — 外部知识库接入

> 交付日期：2026-07-19 | 交付人：郝交付（交付接手）
> 状态：✅ 已实现并通过冒烟测试

## 一、需求（来自 REQUIREMENTS.md FR-8）
让系统通过 `.env` 的 `WUDADAO_KB_PATH` 配置外部 WuDaDao 知识库，而非依赖仓库内固定路径；满足 EARS 行为：
- 普遍约束：始终从 `.env` 配置位置加载知识库
- 事件驱动：启动 / 点「↻ 同步」时依配置重建 RAG 索引
- 异常：未配置或不可达时明确错误/降级，不静默失败
- 可选：未配 RAG 密钥时退化为本地 `data/*.json` 规则生成

## 二、关键设计裁决（技术负责人确认项）
- **D1** 变量名 `WUDADAO_KB_PATH`，接受绝对路径或 `file://` URL（规范化为本地路径）；远程 HTTP 拉取本版不做。
- **D2** 未配置则回退仓库内默认 `WuDaDao/`（保留开箱即用），配置值始终优先，日志明确输出实际来源。
- **D3** 目录不可达 → `loadWiki` 显式抛错；服务端降级规则生成，`/api/meta` 暴露 `wikiStatus:"degraded"` + 错误原因。
- **D4** `/api/reload` 在已配 `RAG_API_KEY` 时异步依据配置路径重建 `rag-index.json`；启动时空索引后台补建。

## 三、改动清单
| 文件 | 改动 |
|---|---|
| `app/src/wiki.js` | 新增 `getWikiRoot()`；`loadWiki(root)` 默认走配置路径，目录不可达显式抛错（移除硬编码 `WIKI_ROOT`） |
| `app/rag/build.js` | **新增**，抽出可复用 `buildRagIndex()` |
| `app/rag/index.js` | 重构为调用 `buildRagIndex()` |
| `app/server.js` | 导入 `getWikiRoot`/`buildRagIndex`；`getWiki` 不可达降级并记录 `wikiError`；`/api/meta` 暴露 `kbConfigured/wikiSource/wikiStatus/wikiError`；`/api/reload` 异步重建 RAG 索引；启动日志与空索引后台补建 |
| `app/public/app.js` | 顶栏 `#kbStatus` 展示知识库状态；`↻ 同步` 反馈降级与 RAG 重建状态 |
| `app/public/index.html` | 新增 `#kbStatus` 状态位 |
| `app/public/styles.css` | 新增 `.kb-status` 样式 |
| `.env.example` | **新增**，含 `WUDADAO_KB_PATH` 与 RAG 配置说明 |
| `.gitignore` | 新增忽略 `.env` / `.env.local` 等（密钥不入库） |
| `REQUIREMENTS.md` | FR-8 状态 → 已实现；补变更日志 |
| `DESIGN.md` | §8.2 环境变量表加 `WUDADAO_KB_PATH`；§9.2/§9.4 补 `build.js` 与可达性说明 |

## 四、冒烟测试结果
| 场景 | 结果 |
|---|---|
| 默认路径（无配置） | `/api/meta`：`wikiStatus:"ok"`，wikiCount=43，wikiSource=仓库内默认 |
| 坏路径 | `/api/meta`：`wikiStatus:"degraded"`，`wikiError` 明确；`/api/guide` 仍返回合法行程（规则生成，rag=false），无 500 |
| `file://` URL | 正确规范化为本地路径并加载 43 篇 |
| `/api/reload` | 返回 `ragRebuild:"started"`，后台重建（密钥无效时失败但仅日志，不崩溃） |

## 五、未覆盖 / 后续
- 远程 HTTP(S) 知识库拉取（FR-8 原"是否支持 URL"待确认项）：本版仅支持本地目录 + `file://`，远程拉取留待后续。
- 真实 RAG 端到端（有效 `RAG_API_KEY` + 真实 embedding）未在本次环境验证（环境密钥无效，已确认降级链路正确）。

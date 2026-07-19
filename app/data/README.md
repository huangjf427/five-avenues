# 本地知识源数据说明（app/data/）

旅游指南除 `WuDaDao/` 历史知识库外，还从以下三类本地数据源抽取信息。
这些文件为**结构化 JSON**，可直接手动编辑扩充；修改后点击界面「↻ 同步知识库」或重启服务即可生效。

> 文件缺失或 JSON 解析失败时，服务会自动降级为空（不影响主流程）。

## 1. `shops.json` — 商业店铺
数组，每个元素：

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识（如 `shop-xxx`），用于关联反馈 |
| `name` | 店铺名 |
| `category` | 类别：`餐饮` / `咖啡` / `文创` / `购物` / `书店` / `甜品` |
| `address` | 地址（含道路与门牌），用于行程站点与地图 |
| `road` | 所属道路（五大道路名之一），用于聚类 |
| `features` | 特色标签数组，如 `["露台","手冲"]` |
| `tags` | 兴趣标签，建议取自：`美食` `购物` `文创` `咖啡` `休闲` `历史` `亲子` `西餐` `建筑` |
| `summary` | 一句话简介 |
| `rating` | 店铺自身评分（0–5，可选） |
| `relatedPages` | 关联 `WuDaDao` 页面 id（可选） |

## 2. `activities.json` — 本地文化 / 旅游活动
数组，每个元素：

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识（如 `act-xxx`） |
| `title` | 活动名称 |
| `startDate` / `endDate` | 起止日期 `YYYY-MM-DD`，用于与行程日期窗口匹配 |
| `location` | 举办地点 / 道路 |
| `type` | 类型：`节庆` / `市集` / `展览` / `导览` / `演出` / `研学` |
| `tags` | 兴趣标签（同 shops） |
| `summary` | 一句话简介 |
| `relatedPages` | 关联 wiki 页面 id（可选） |

活动仅在**与所选旅行日期窗口重叠**时出现在「节事日历」中。

## 3. `feedback.json` — 游客反馈（仅排序加权）
数组，每个元素：

| 字段 | 说明 |
| --- | --- |
| `targetId` | 目标 id：`shops.json` 的 `id` / `activities.json` 的 `id` / wiki 页面 id |
| `targetType` | `shop` / `activity` / `page` |
| `rating` | 评分 0–5 |
| `comment` | 评论文本 |
| `tags` | 评论标签 |

**反馈不单独成节展示**，仅作为排序信号：平均评分 ≥4.5 加权 ×1.2、≥4.0 ×1.1、<3.0 ×0.9，使高口碑地点在推荐中优先。

## 4. `reviews.json` — 游客 Wiki 评价（面向公众，需审核）
由「游客 Wiki」功能自动生成，无需手动创建。与 `feedback.json` 不同：feedback 是**内部排序信号**（不展示），reviews 是**面向公众的用户评价**，仅在管理员审核通过后展示。

| 字段 | 说明 |
| --- | --- |
| `id` | UUID |
| `rating` | 评分 1–5 |
| `title` / `body` | 标题（可选）/ 正文 |
| `tags` | 标签数组 |
| `targetType` | `overall`（整体行程）/ `shop` / `activity` |
| `targetId` / `targetName` | 关联对象（overall 时为 null） |
| `authorId` / `authorName` | 作者；匿名时 authorId=null、authorName="匿名游客" |
| `anonymous` | 是否匿名发布 |
| `status` | `pending` / `approved` / `rejected` —— 仅 approved 对外展示 |
| `reviewedAt` / `reviewedBy` / `moderationNote` | 审核元数据 |

## 5. `users.json` — 账号（自动生成）
账号系统数据，无需手动编辑。密码以 scrypt 加盐哈希存储。角色为 `visitor` 或 `admin`。

- 首次启动自动创建管理员，默认 `admin` / `admin12345`。
- 环境变量覆盖：`ADMIN_USER`、`ADMIN_PASS`。
- 游客需先**登录**才能发表评价（登录后可选匿名发布）；未登录提交将被拒绝（见 `REQUIREMENTS.md` FR-2 / REG-14）。
- 会话为进程内内存 token（Cookie `fa_session`），重启后需重新登录。

> `users.json` 含密码哈希，请勿提交到公开仓库（建议加入 .gitignore）。

## 编辑约定
- 保持合法 JSON（数组、双引号、无尾逗号）。
- 新增条目请补全 `id`（保证唯一）与 `tags`（决定被哪些兴趣命中）。
- 兴趣标签与 `../src/recommender.js` 中 `INTERESTS` 的 `tags`/`terms` 对应；新增兴趣需同步修改该文件。

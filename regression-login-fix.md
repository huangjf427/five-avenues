# 回归测试清单 —— 登录前越权/越界界面可见问题

> 关联提交：`3216ed6` "Revise code to ensure not unrelevant screen present before login"
> 阶段：阶段四 · 修复验证（对应工作项 `rMGEyO` / 子项 `r4f0VU`、`rW2CNk`）
> 影响文件：`app/public/app.js`、`app/public/index.html`、`app/public/styles.css`
> 关联 Bug 事项：未登录时越权界面（我的评价/审核后台）可见

## 根因
部分 CSS `display` 规则覆盖了 HTML 的 `hidden` 属性，导致未登录时「我的评价」「审核后台」等面板/按钮仍可见（"irrelevant screen present before login"）。

## 修复要点
1. 全局样式新增 `[hidden] { display: none !important; }`，强制隐藏带 `hidden` 的元素。
2. `showView()` 增加纵深防御：未登录访问 `my-reviews` → 跳回 `guide`；非管理员访问 `admin` → 跳回 `guide`。
3. `applyUser()` 用 `querySelectorAll('.admin-only')` 隐藏全部管理元素，并强制隐藏 `view-my-reviews` / `view-admin` 面板。
4. Wiki 评价区：未登录时隐藏写评价表单（`#reviewFormPanel`）、显示登录引导（`#reviewLoginPrompt` + `#wikiLoginBtn`）。

## 回归用例

### A. 全局样式
- [ ] A1 任意带 `hidden` 属性的元素在页面上均不可见（无残留 `display` 覆盖）。

### B. 游客态（未登录）
- [ ] B1 「我的评价」导航按钮不可见。
- [ ] B2 「我的评价」视图面板（`#view-my-reviews`）不可见。
- [ ] B3 「审核后台」(`admin-only` 元素 / `#view-admin`) 不可见。
- [ ] B4 Wiki 评价区显示登录引导（`#reviewLoginPrompt`），**不显示**写评价表单（`#reviewFormPanel`）。
- [ ] B5 直接调用 `showView('my-reviews')` 未登录 → 自动跳回 `guide`（纵深防御）。
- [ ] B6 直接调用 `showView('admin')` 非管理员 → 自动跳回 `guide`（纵深防御）。

### C. 普通用户（已登录，非管理员）
- [ ] C1 可见「我的评价」，不可见「审核后台」。
- [ ] C2 Wiki 评价区显示写评价表单，可发表（可选择匿名）。

### D. 管理员
- [ ] D1 可见「审核后台」并可进入审核。
- [ ] D2 可见「我的评价」。

### E. 兼容性 / 边界
- [ ] E1 `!important` 未破坏其他 `display` 相关样式（如 flex 布局、导航高亮）。
- [ ] E2 登录/登出切换后，上述可见性状态正确刷新。

## PO 确认结论（已闭环）
- ✅ **行为变更确认**：原「游客可匿名发表评价」改为「必须登录后发表」，**PO 确认是预期产品行为，非回归、非需求变更**。回归时按"必须登录才能发表"作为期望结果判定。
- ✅ **需求/实现不一致关闭**：`rag Design/requirements.txt` 推荐的 Python 技术栈为**过时文档**，实际以 `app/rag/*` 的 **Node.js** 实现为准，该项不再作为风险跟踪。

## 遗留风险
- 无（两项待确认风险均已由 PO 确认闭环）。

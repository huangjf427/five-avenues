// T-M.1 埋点上报模块（零依赖，使用 Node 内置 fetch）。
//
// 合规（NFR-8 / T-M.4）：仅上报计数、标签、原因分类与长度等脱敏字段，
// 绝不采集密码明文或评价正文全文；匿名 / 游客不关联用户标识。
// 失败兜底：上报请求失败或被禁用时，静默丢弃，绝不影响主流程
// （fire-and-forget + catch 吞掉所有异常）。
//
// 上报端点（A1，研发定稿）：通过环境变量 ANALYTICS_ENDPOINT 配置；未配置则
// 视为"暂不开启埋点"，track() 直接 no-op，不报错、不阻塞。

const ENDPOINT = (process.env.ANALYTICS_ENDPOINT || '').trim();

export function track(event, fields = {}) {
  if (!ENDPOINT) return; // 未配置端点：静默丢弃
  const payload = { event, ts: Date.now(), ...fields };
  // 任何同步 / 异步异常都吞掉，保证主流程不受影响。
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* 吞掉异常 */
  }
}

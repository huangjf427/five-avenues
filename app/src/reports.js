import { randomUUID } from 'node:crypto';
import { JsonStore } from './store.js';
import { moderate } from './reviews.js';
import { track } from './analytics.js';

// 评价举报工单（FR-12 / FR-13）。
// 与 reviews.json 分离存储，遵循 NFR-4（gitignore、零依赖）。
//
// 一条举报记录：
//   { id, reviewId, reason, reporterId, reporterName,
//     status: 'pending'|'resolved'|'dismissed',
//     createdAt, resolvedAt|null, resolvedBy|null, decision|null, resolveNote|null }
//
// 隐私（T-12.4）：reporterId / reporterName 仅管理员可见，举报信息绝不会出现在
// 任何公开 API（toPublic 投影不含任何 report 字段），因此被举报者无从得知举报人。

const reports = new JsonStore('reports.json');

const REPORT_REASONS = ['垃圾广告', '不实信息', '不当内容', '骚扰', '其他'];

export function reportReasons() {
  return REPORT_REASONS;
}

export async function createReport({ reviewId, reason, user }) {
  const reasonText = String(reason || '').trim();
  if (!reasonText) throw new Error('举报原因不能为空');

  return reports.update((list) => {
    // T-12.2：同一用户对同一评价 10 分钟内重复举报拦截。
    const recent = list.find(
      (r) =>
        r.reviewId === reviewId &&
        r.reporterId === user.id &&
        r.status === 'pending' &&
        Date.now() - new Date(r.createdAt).getTime() < 10 * 60 * 1000
    );
    if (recent) throw new Error('10 分钟内已举报过该评价，请勿重复提交');

    const record = {
      id: randomUUID(),
      reviewId,
      reason: reasonText,
      reporterId: user.id,
      reporterName: user.username, // 仅管理员可见（T-12.4）
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      decision: null,
      resolveNote: null,
    };
    return { result: { id: record.id, status: 'pending' }, next: [record, ...list] };
  });
}

export async function listReports({ status } = {}) {
  const list = await reports.readAll();
  return list
    .filter((r) => (status ? r.status === status : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function reportCounts() {
  const list = await reports.readAll();
  const c = { pending: 0, resolved: 0, dismissed: 0 };
  for (const r of list) if (c[r.status] !== undefined) c[r.status] += 1;
  return c;
}

// FR-13.1：处理一条举报工单。
//   decision = 'uphold'  → 驳回举报（举报转 dismissed，评价维持 approved）
//   decision = 'dismiss'  → 采纳举报（举报转 resolved，关联评价转 rejected 下架）
// 两种决定都记录操作人与时间。
export async function resolveReport(id, { decision, note }, admin) {
  if (!['uphold', 'dismiss'].includes(decision)) throw new Error('无效的处理决定');

  const out = await reports.update((list) => {
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('举报工单不存在');
    const r = list[idx];
    if (r.status !== 'pending') throw new Error('该举报已处理');
    r.status = decision === 'uphold' ? 'dismissed' : 'resolved';
    r.decision = decision;
    r.resolvedAt = new Date().toISOString();
    r.resolvedBy = admin.username;
    r.resolveNote = String(note || '').slice(0, 200) || null;
    return { result: { id: r.id, status: r.status, decision, reviewId: r.reviewId }, next: list };
  });

  // 采纳举报 → 评价下架（转 rejected，从公开列表消失）。
  if (out.decision === 'dismiss') {
    await moderate(out.reviewId, { action: 'reject', note: '举报核实后下架' }, admin);
  }

  // T-M.3 服务端双写 report_resolve（不含隐私红线字段）。
  track('report_resolve', { decision: out.decision });
  return out;
}

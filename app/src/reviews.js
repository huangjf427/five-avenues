import { randomUUID } from 'node:crypto';
import { JsonStore } from './store.js';

// The "游客 Wiki": visitor-authored reviews of the Five Avenues experience.
// These are DISTINCT from feedback.json (an internal ranking signal). Reviews
// are public-facing UGC and only appear after an admin approves them.
//
// A review record:
//   { id, rating(1-5), title, body, tags[],
//     targetType: 'overall'|'shop'|'activity', targetId|null, targetName|null,
//     authorId|null, authorName,      // authorName may be a display name or '匿名游客'
//     anonymous: bool,
//     status: 'pending'|'approved'|'rejected',
//     createdAt, reviewedAt|null, reviewedBy|null, moderationNote|null }

const reviews = new JsonStore('reviews.json');

const MAX_BODY = 2000;
const MAX_TITLE = 80;

function clampRating(r) {
  const n = Math.round(Number(r));
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, n));
}

function clean(str, max) {
  return String(str || '').trim().slice(0, max);
}

// Public projection — never leak author id or moderation internals to visitors.
function toPublic(r) {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    tags: r.tags || [],
    targetType: r.targetType,
    targetName: r.targetName || null,
    authorName: r.anonymous ? '匿名游客' : r.authorName,
    anonymous: !!r.anonymous,
    createdAt: r.createdAt,
  };
}

export async function createReview(input, user) {
  const rating = clampRating(input.rating);
  const body = clean(input.body, MAX_BODY);
  const title = clean(input.title, MAX_TITLE);
  if (!rating) throw new Error('请给出 1–5 的评分');
  if (body.length < 5) throw new Error('评价内容至少 5 个字');

  const anonymous = !!input.anonymous || !user;
  const targetType = ['shop', 'activity'].includes(input.targetType) ? input.targetType : 'overall';
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => clean(t, 20)).filter(Boolean).slice(0, 6)
    : [];

  const record = {
    id: randomUUID(),
    rating,
    title: title || '',
    body,
    tags,
    targetType,
    targetId: targetType === 'overall' ? null : clean(input.targetId, 60) || null,
    targetName: targetType === 'overall' ? null : clean(input.targetName, 120) || null,
    authorId: anonymous ? null : user.id,
    authorName: anonymous ? '匿名游客' : user.username,
    anonymous,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    moderationNote: null,
  };

  return reviews.update((list) => ({
    result: toPublic(record),
    next: [record, ...list],
  }));
}

// Public feed: only approved reviews, newest first. Optional target filter.
export async function listApproved({ targetType, targetId } = {}) {
  const list = await reviews.readAll();
  return list
    .filter((r) => r.status === 'approved')
    .filter((r) => (targetType ? r.targetType === targetType : true))
    .filter((r) => (targetId ? r.targetId === targetId : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(toPublic);
}

// Admin view: full records, optionally filtered by status.
export async function listForAdmin({ status } = {}) {
  const list = await reviews.readAll();
  return list
    .filter((r) => (status ? r.status === status : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function counts() {
  const list = await reviews.readAll();
  const c = { pending: 0, approved: 0, rejected: 0 };
  for (const r of list) if (c[r.status] !== undefined) c[r.status] += 1;
  return c;
}

// Exported for /api/my-reviews (needs direct access to all records including authorId).
export async function readAllReviews() {
  return reviews.readAll();
}

export async function moderate(id, { action, note }, admin) {
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
  if (!status) throw new Error('无效的审核操作');
  return reviews.update((list) => {
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('评价不存在');
    const r = list[idx];
    r.status = status;
    r.reviewedAt = new Date().toISOString();
    r.reviewedBy = admin.username;
    r.moderationNote = clean(note, 200) || null;
    return { result: { id: r.id, status: r.status }, next: list };
  });
}

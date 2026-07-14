import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');

// Read a JSON file; on missing file or parse error, fall back to an empty array
// so the main flow never breaks when optional data is absent.
async function readJson(name) {
  const file = join(DATA_DIR, name);
  try {
    await stat(file);
    const text = await readFile(file, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Aggregate visitor feedback into a per-target lookup: average rating + count.
function buildFeedbackMap(feedback) {
  const map = new Map();
  for (const f of feedback) {
    if (!f || !f.targetId || typeof f.rating !== 'number') continue;
    const key = f.targetId;
    const cur = map.get(key) || { sum: 0, count: 0 };
    cur.sum += f.rating;
    cur.count += 1;
    map.set(key, cur);
  }
  const out = {};
  for (const [id, v] of map) out[id] = { avg: v.sum / v.count, count: v.count };
  return out;
}

function normalizeShop(s) {
  return {
    kind: 'shop',
    id: s.id,
    title: s.name || s.id,
    category: s.category || '店铺',
    address: s.address || '',
    road: s.road || '',
    features: Array.isArray(s.features) ? s.features : [],
    tags: Array.isArray(s.tags) ? s.tags : [],
    summary: s.summary || '',
    rating: typeof s.rating === 'number' ? s.rating : null,
    relatedPages: Array.isArray(s.relatedPages) ? s.relatedPages : [],
    isVisitable: !!(s.address || s.road),
  };
}

function normalizeActivity(a) {
  return {
    kind: 'activity',
    id: a.id,
    title: a.title || a.id,
    category: a.type || '活动',
    address: a.location || '',
    road: a.location || '',
    features: [],
    tags: Array.isArray(a.tags) ? a.tags : [],
    summary: a.summary || '',
    rating: null,
    startDate: a.startDate || '',
    endDate: a.endDate || '',
    relatedPages: Array.isArray(a.relatedPages) ? a.relatedPages : [],
    isVisitable: !!a.location,
  };
}

// Load and normalize the three local data sources. Returns a stable shape that
// the recommender and generator consume.
export async function loadExtra() {
  const [shopsRaw, activitiesRaw, feedbackRaw] = await Promise.all([
    readJson('shops.json'),
    readJson('activities.json'),
    readJson('feedback.json'),
  ]);

  const shops = shopsRaw.map(normalizeShop);
  const activities = activitiesRaw.map(normalizeActivity);
  const feedbackMap = buildFeedbackMap(feedbackRaw);

  return { shops, activities, feedbackMap };
}

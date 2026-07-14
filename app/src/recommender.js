// Maps user intent (interests + travel purpose) onto the wiki's tag/structure space
// and produces a ranked, personalized selection of pages.

export const INTERESTS = [
  { id: 'architecture', label: '建筑与风貌', tags: ['建筑', '风貌', 'architecture'], terms: ['建筑风格', '洋楼', '风貌建筑', '花园城市', '西式'] },
  { id: 'history', label: '近代历史', tags: ['历史', '民国', '清', 'history'], terms: ['历史', '沿革', '变迁', '开埠', '租界'] },
  { id: 'royalty', label: '皇族遗民', tags: ['皇族', '遗老', '清室', 'royal'], terms: ['皇族', '遗老', '溥仪', '复辟', '王府', '庆亲王'] },
  { id: 'beiyang', label: '北洋军政', tags: ['北洋', '军阀', '直系', '皖系', 'beiyang'], terms: ['北洋', '军阀', '贿选', '府院', '曹锟', '段祺瑞'] },
  { id: 'military', label: '军事与抗战', tags: ['军事', '抗日', 'military'], terms: ['抗日', '战争', '将领', '张自忠', '张学良', '孙殿英'] },
  { id: 'education', label: '教育与文教', tags: ['教育', '文教', 'education'], terms: ['南开', '张伯苓', '学校', '教育'] },
  { id: 'culture', label: '文化名流', tags: ['文化', '名流', 'culture'], terms: ['李叔同', '文人', '文化', '名流', '艺术'] },
  { id: 'foreign', label: '外国侨民', tags: ['侨民', '外国', 'foreign'], terms: ['侨民', '德璀琳', '李爱锐', '胡佛', '外国人'] },
  { id: 'figures', label: '名人故居', tags: ['person'], terms: [] },
  { id: 'events', label: '重大事件', tags: ['event'], terms: [] },
  { id: 'food', label: '美食餐饮', tags: ['美食', '西餐', '京鲁菜', '咖啡'], terms: ['餐厅', '咖啡', '麻花', '烤鸭', '西餐', '蛋糕', '手冲'] },
  { id: 'shopping', label: '购物休闲', tags: ['购物', '文创', '特产'], terms: ['伴手礼', '文创', '明信片', '集章', '礼盒'] },
  { id: 'leisure', label: '休闲生活', tags: ['休闲', '咖啡'], terms: ['露台', '小憩', '休憩', '避暑', '慢节奏'] },
];

export const PURPOSES = [
  { id: 'leisure', label: '休闲观光', catWeight: { '10-themes': 1.0, '20-research': 1.1, '30-writing': 0.8 }, subWeight: { people: 1.3, events: 0.8, places: 1.4, sources: 0.5 }, extra: { shop: 1.4, activity: 1.1 }, depth: 'light', bias: ['architecture', 'figures', 'food', 'leisure'] },
  { id: 'research', label: '深度历史研学', catWeight: { '10-themes': 1.2, '20-research': 1.4, '30-writing': 1.1 }, subWeight: { people: 1.1, events: 1.4, places: 0.9, sources: 1.3 }, extra: { shop: 0.7, activity: 1.0 }, depth: 'deep', bias: ['history', 'beiyang', 'events'] },
  { id: 'photography', label: '建筑摄影', catWeight: { '10-themes': 1.0, '20-research': 1.0, '30-writing': 1.2 }, subWeight: { people: 1.4, events: 0.7, places: 1.5, sources: 0.5 }, extra: { shop: 1.0, activity: 0.9 }, depth: 'light', bias: ['architecture'] },
  { id: 'family', label: '亲子教育', catWeight: { '10-themes': 1.1, '20-research': 1.2, '30-writing': 1.0 }, subWeight: { people: 1.2, events: 1.0, places: 1.1, sources: 0.6 }, extra: { shop: 1.3, activity: 1.2 }, depth: 'light', bias: ['education', 'culture', 'figures', 'food'] },
  { id: 'culture', label: '文化体验', catWeight: { '10-themes': 1.2, '20-research': 1.1, '30-writing': 1.1 }, subWeight: { people: 1.2, events: 1.0, places: 1.0, sources: 0.7 }, extra: { shop: 1.2, activity: 1.2 }, depth: 'medium', bias: ['culture', 'royalty', 'foreign', 'shopping'] },
];

function interestById(id) {
  return INTERESTS.find((i) => i.id === id);
}
export function purposeById(id) {
  return PURPOSES.find((p) => p.id === id) || PURPOSES[0];
}

// Score a single page against selected interests + purpose.
function scorePage(page, selectedInterests, purpose) {
  let score = 0;
  const bodyLower = page.body.toLowerCase();
  const tagSet = new Set(page.tags.map((t) => t.toLowerCase()));

  for (const id of selectedInterests) {
    const it = interestById(id);
    if (!it) continue;
    // tag overlap
    for (const t of it.tags) if (tagSet.has(t.toLowerCase())) score += 3;
    // free-text term hits
    let hits = 0;
    for (const term of it.terms) {
      if (page.body.includes(term)) hits += 1;
    }
    score += Math.min(hits * 0.6, 3);
  }

  // purpose category / subcategory weighting
  const cw = purpose.catWeight[page.category] ?? 1.0;
  const sw = purpose.subWeight[page.subcategory] ?? 1.0;
  score *= cw * sw;

  // visitable pages are more useful for an itinerary
  if (page.isVisitable) score *= 1.25;

  // bias interests get a small lift
  for (const b of purpose.bias || []) {
    if (selectedInterests.includes(b)) score *= 1.1;
  }

  return score;
}

// Rank all pages, returning a sorted array with scores.
export function rankPages(pages, selectedInterests, purposeId) {
  const purpose = purposeById(purposeId);
  return pages
    .map((p) => ({ page: p, score: scorePage(p, selectedInterests, purpose) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ----- Local data sources (shops / activities / feedback) -----

function interestMatchScore(item, selectedInterests) {
  let score = 0;
  const tagSet = new Set((item.tags || []).map((t) => String(t).toLowerCase()));
  const haystack = [item.summary || '', ...(item.features || [])].join(' ');
  for (const id of selectedInterests) {
    const it = interestById(id);
    if (!it) continue;
    for (const t of it.tags) if (tagSet.has(t.toLowerCase())) score += 3;
    let hits = 0;
    for (const term of it.terms) if (haystack.includes(term)) hits += 1;
    score += Math.min(hits * 0.6, 3);
  }
  return score;
}

// Visitor feedback only acts as a ranking signal: bump strong ratings up,
// nudge weak ones down. Never surfaced as its own section.
function applyFeedback(score, feedbackMap, id) {
  const fb = feedbackMap && feedbackMap[id];
  if (!fb) return score;
  if (fb.avg >= 4.5) return score * 1.2;
  if (fb.avg >= 4.0) return score * 1.1;
  if (fb.avg < 3.0) return score * 0.9;
  return score;
}

function scoreShop(shop, selectedInterests, purpose, feedbackMap) {
  let score = interestMatchScore(shop, selectedInterests);
  if (score === 0) score = 0.6; // base visibility so food/shopping interests always see shops
  score *= purpose.extra?.shop ?? 1.0;
  if (shop.rating) score *= 1 + (shop.rating - 4) * 0.1; // higher rated shops rank a bit higher
  return applyFeedback(score, feedbackMap, shop.id);
}

export function rankShops(shops, selectedInterests, purposeId, feedbackMap) {
  const purpose = purposeById(purposeId);
  return shops
    .map((s) => ({ item: s, score: scoreShop(s, selectedInterests, purpose, feedbackMap) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// Does an activity's [start,end] window overlap the travel [s,e] window?
// With no travel dates given, everything is considered in-window.
export function dateOverlaps(activity, travelStart, travelEnd) {
  const s = parseDate(travelStart);
  const e = parseDate(travelEnd);
  if (!s || !e) return true;
  const a = parseDate(activity.startDate);
  const b = parseDate(activity.endDate) || a;
  if (!a || !b) return true;
  return a <= e && b >= s;
}

function scoreActivity(activity, selectedInterests, purpose, feedbackMap, travelStart, travelEnd) {
  if (!dateOverlaps(activity, travelStart, travelEnd)) return 0;
  let score = interestMatchScore(activity, selectedInterests);
  if (score === 0) score = 0.6;
  score *= purpose.extra?.activity ?? 1.0;
  return applyFeedback(score, feedbackMap, activity.id);
}

export function rankActivities(activities, selectedInterests, purposeId, feedbackMap, travelStart, travelEnd) {
  const purpose = purposeById(purposeId);
  return activities
    .map((a) => ({ item: a, score: scoreActivity(a, selectedInterests, purpose, feedbackMap, travelStart, travelEnd) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

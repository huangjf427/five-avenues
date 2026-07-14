// 基于 RAG 的行程生成（零依赖；通过 Node18 fetch 调大模型）。
// 流程：用户意图 -> 向量检索 WuDaDao 语料 -> 构造 prompt -> 大模型生成
// -> 解析并校验为与现有 /api/guide 完全同构的 guide 对象。
// 任何一步失败（无索引 / 模型不可用 / 输出非法）都抛错，由 server.js 降级到规则生成。

import { retrieve } from './retrieve.js';
import { embedOne, chat } from './embed.js';
import { purposeById, INTERESTS } from '../src/recommender.js';

function interestLabels(interests) {
  return (interests || [])
    .map((id) => INTERESTS.find((i) => i.id === id)?.label)
    .filter(Boolean);
}

const SYSTEM = `你是天津五大道文旅行程助手。基于给定的本地知识库片段与本地数据，生成结构化行程指南。
必须严格只输出一个 JSON 对象（不要任何额外文字、不要 markdown 代码块、不要解释）：
{
  "overview": "行程概览（2-4 句，概括目的、兴趣、天数、季节）",
  "itinerary": [ { "day": 1, "theme": "当日主题", "stops": [ { "kind": "wiki", "title": "点位名", "address": "地址或空串", "category": "分类", "why": "推荐理由一句", "snippet": "简介一句", "rating": null } ] } ],
  "history": [ { "title": "人物/事件", "category": "分类", "date": "年份或空串", "summary": "一句" } ],
  "architecture": [ { "title": "建筑/风貌", "address": "地址或空串", "snippet": "一句" } ],
  "shops": [ { "title": "店名", "category": "餐饮/咖啡/...", "address": "地址或空串", "rating": null, "features": [], "summary": "一句" } ],
  "eventCalendar": { "label": "节事日历", "items": [ { "title":"", "type":"", "location":"", "start":"", "end":"", "summary":"", "rating": null } ], "hasDates": true },
  "seasonal": { "seasonLabel": "春/夏/秋/冬季", "notes": ["季节建议1","季节建议2"], "historicalEvents": [ { "title":"", "month": 7, "summary":"" } ] }
}
约束：所有内容必须来自提供的知识库片段与本地数据，不得编造地址、日期或来源；itinerary 每天 2-4 个 stop；shops 优先选用给定商户；eventCalendar.items 来自给定活动列表。`;

function buildUser({ purposeLabel, interestLabels, shops, activities, context }) {
  const shopLines = (shops || [])
    .slice(0, 10)
    .map((s) => `- ${s.title}（${s.category || ''}）${s.address ? ' @ ' + s.address : ''}`)
    .join('\n');
  const actLines = (activities || [])
    .slice(0, 10)
    .map((a) => `- ${a.title}（${a.category || ''}）${a.startDate ? ' ' + a.startDate + '~' + (a.endDate || '') : ''}`)
    .join('\n');
  return `旅行目的：${purposeLabel}
兴趣方向：${interestLabels.join('、') || '五大道历史人文'}

可推荐商户/购物（来自本地数据，优先选用）：
${shopLines || '（无）'}

行程窗口内活动（来自本地数据）：
${actLines || '（无）'}

==== 本地知识库检索片段（仅可引用以下内容）====
${context}`;
}

function parseRange(startDate, endDate) {
  const s = startDate ? new Date(startDate) : null;
  const e = endDate ? new Date(endDate) : null;
  if (s && e && !isNaN(s) && !isNaN(e) && s <= e) {
    const days = Math.min(14, Math.max(1, Math.round((e - s) / 86400000) + 1));
    const months = new Set();
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) months.add(d.getMonth() + 1);
    const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { days, months: [...months], label: `${fmt(s)} 至 ${fmt(e)}（${days} 天）` };
  }
  return { days: 2, months: [], label: '未指定日期（默认 2 日行程）' };
}

function seasonOf(months) {
  const set = new Set(months);
  if ([3, 4, 5].some((m) => set.has(m))) return { label: '春季', key: 'spring' };
  if ([6, 7, 8].some((m) => set.has(m))) return { label: '夏季', key: 'summer' };
  if ([9, 10, 11].some((m) => set.has(m))) return { label: '秋季', key: 'autumn' };
  if (months.length) return { label: '冬季', key: 'winter' };
  return { label: '未指定季节', key: 'none' };
}

// 校验 LLM 输出是否符合 guide 契约；不合规则抛错触发降级。
function validate(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('输出非对象');
  if (typeof g.overview !== 'string') throw new Error('缺 overview');
  for (const k of ['itinerary', 'history', 'architecture', 'shops']) {
    if (!Array.isArray(g[k])) throw new Error(`字段 ${k} 非数组`);
  }
  if (!g.eventCalendar || typeof g.eventCalendar !== 'object') throw new Error('缺 eventCalendar');
  if (!Array.isArray(g.eventCalendar.items)) throw new Error('eventCalendar.items 非数组');
  if (!g.seasonal || typeof g.seasonal !== 'object') throw new Error('缺 seasonal');
  if (!Array.isArray(g.seasonal.notes)) throw new Error('seasonal.notes 非数组');
  if (!Array.isArray(g.seasonal.historicalEvents)) throw new Error('seasonal.historicalEvents 非数组');
  return true;
}

function cleanJson(raw) {
  let t = (raw || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return t.trim();
}

export async function buildGuideRag({
  pages,
  shops = [],
  activities = [],
  feedbackMap = {},
  purposeId,
  interests = [],
  startDate,
  endDate,
  index,
}) {
  if (!index || !Array.isArray(index.chunks) || !index.chunks.length) {
    throw new Error('RAG 索引为空');
  }
  const purpose = purposeById(purposeId);
  const labels = interestLabels(interests);

  const queryText = `${purpose.label} ${labels.join(' ')} ${(shops || []).map((s) => s.title).join(' ')}`.slice(0, 2000);
  const queryVec = await embedOne(queryText);
  const hits = retrieve(index, queryVec, { topK: 12 });

  const context = hits
    .map((h) => `【${h.chunk.title}】（${h.chunk.category}）\n${h.chunk.text}`)
    .join('\n\n');
  const user = buildUser({ purposeLabel: purpose.label, interestLabels: labels, shops, activities, context });
  const raw = await chat(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    { temperature: 0.4, json: true }
  );

  let g;
  try {
    g = JSON.parse(cleanJson(raw));
  } catch {
    throw new Error('LLM 输出非合法 JSON');
  }
  validate(g);

  // 用真实检索页的来源补全 sources，避免模型编造外链。
  const sources = [];
  const seen = new Set();
  for (const h of hits) {
    for (const s of h.chunk.sources || []) {
      if (s && s.url && !seen.has(s.url)) {
        seen.add(s.url);
        sources.push(s);
      }
    }
  }
  g.sources = sources;

  const range = parseRange(startDate, endDate);
  const season = seasonOf(range.months);
  g.meta = {
    purposeLabel: purpose.label,
    interestLabels: labels,
    dateLabel: range.label,
    days: range.days,
    seasonLabel: season.label,
    shopCount: shops.length,
    activityCount: activities.length,
  };
  return g;
}

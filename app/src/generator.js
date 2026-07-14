import { rankPages, rankShops, rankActivities, dateOverlaps, INTERESTS, purposeById } from './recommender.js';

const CAT_LABEL = {
  people: '人物故居',
  events: '历史事件',
  places: '地理空间',
  sources: '史料考证',
  overview: '宏观综述',
  analysis: '专题分析',
  drafts: '成文草稿',
  outlines: '项目大纲',
  notes: '写作素材',
  questions: '研究问题',
  insights: '研究洞见',
  reviews: '阶段回顾',
  articles: '文章',
  reports: '报告',
  books: '书籍',
  worklog: '工作日志',
  outdated: '归档',
};

function catLabel(page) {
  return CAT_LABEL[page.subcategory] || CAT_LABEL[page.category] || page.category;
}

function snippet(text, max = 130) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function firstSentence(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^[^。！？!?]+[。！？!?]/);
  return (m ? m[0] : clean).trim();
}

export function buildGuide({ pages, shops = [], activities = [], feedbackMap = {}, purposeId, interests = [], startDate, endDate }) {
  const purpose = purposeById(purposeId);
  const interestLabels = interests.map((id) => INTERESTS.find((i) => i.id === id)?.label).filter(Boolean);
  const ranked = rankPages(pages, interests, purposeId);
  const shopRanked = rankShops(shops, interests, purposeId, feedbackMap);
  const actRanked = rankActivities(activities, interests, purposeId, feedbackMap, startDate, endDate);

  const { days, months, dateLabel } = parseDates(startDate, endDate);
  const season = seasonOf(months);

  const overview = buildOverview({ purpose, interestLabels, ranked, shopRanked, actRanked, days, season });
  const itinerary = buildItinerary({ ranked, shopRanked, days, interestLabels, months });
  const history = buildHistory(ranked, purpose);
  const architecture = buildArchitecture(ranked, pages);
  const shopsSection = buildShops(shopRanked);
  const eventCalendar = buildEventCalendar({ actRanked, startDate, endDate, feedbackMap });
  const seasonal = buildSeasonal({ pages, months, season });
  const sources = collectSources(ranked);

  return {
    meta: {
      purposeLabel: purpose.label,
      interestLabels,
      dateLabel,
      days,
      seasonLabel: season.label,
      shopCount: shops.length,
      activityCount: activities.length,
    },
    overview,
    itinerary,
    history,
    architecture,
    shops: shopsSection,
    eventCalendar,
    seasonal,
    sources,
  };
}

function parseDates(startDate, endDate) {
  let s = startDate ? new Date(startDate) : null;
  let e = endDate ? new Date(endDate) : null;
  if (s && isNaN(s)) s = null;
  if (e && isNaN(e)) e = null;
  if (s && e && s > e) [s, e] = [e, s];

  if (!s || !e) {
    return { days: 2, months: [], dateLabel: '未指定日期（默认 2 日行程）' };
  }
  const days = Math.min(14, Math.max(1, Math.round((e - s) / 86400000) + 1));
  const months = new Set();
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) months.add(d.getMonth() + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { days, months: [...months], dateLabel: `${fmt(s)} 至 ${fmt(e)}（${days} 天）` };
}

function seasonOf(months) {
  if (!months.length) return { label: '未指定季节', key: 'none' };
  const set = new Set(months);
  if ([3, 4, 5].some((m) => set.has(m))) return { label: '春季', key: 'spring' };
  if ([6, 7, 8].some((m) => set.has(m))) return { label: '夏季', key: 'summer' };
  if ([9, 10, 11].some((m) => set.has(m))) return { label: '秋季', key: 'autumn' };
  return { label: '冬季', key: 'winter' };
}

function buildOverview({ purpose, interestLabels, ranked, shopRanked, actRanked, days, season }) {
  const top = ranked.slice(0, 6).map((r) => r.page.title);
  const focus = interestLabels.length ? interestLabels.join('、') : '五大道历史人文';
  const lines = [];
  lines.push(
    `本行程以「${focus}」为核心，围绕你的旅行目的「${purpose.label}」量身定制，共 ${days} 天。五大道位于天津和平区，约 1.28 平方公里，2000 余处风貌建筑鳞次栉比，是步行友好的近代历史街区。`
  );
  if (top.length) {
    lines.push(`结合本地知识库，为你精选了以下人文重点：${top.join('、')}。`);
  }
  if (shopRanked.length) {
    lines.push(`另据本地商铺与游客口碑，为你安排 ${shopRanked.length} 处美食·购物站点，穿插于每日动线。`);
  }
  if (actRanked.length) {
    lines.push(`行程窗口内还有 ${actRanked.length} 项本地文化/旅游活动，详见「节事日历」。`);
  }
  if (season.key !== 'none') {
    lines.push(`出行季节为${season.label}，可参考下方「季节与节事」建议合理安排着装与动线。`);
  }
  return lines.join('\n');
}

function buildItinerary({ ranked, shopRanked, days, interestLabels, months }) {
  const wikiStops = ranked
    .filter((r) => r.page.isVisitable)
    .map((r) => r.page);

  const pool = wikiStops.length ? wikiStops : ranked.slice(0, Math.min(days * 3, 12)).map((r) => r.page);
  const shopItems = shopRanked.map((r) => r.item);
  if (!pool.length && !shopItems.length) return [];

  const perDay = Math.max(2, Math.ceil(pool.length / days));
  const dayThemes = buildDayThemes(interestLabels, days);
  const result = [];
  let shopIdx = 0;

  for (let d = 0; d < days; d++) {
    const slice = pool.slice(d * perDay, d * perDay + perDay);
    const items = slice.map((p) => ({
      kind: 'wiki',
      title: p.title,
      address: p.addresses[0] || '',
      category: catLabel(p),
      why: firstSentence(p.summary),
      snippet: p.sections['五大道居所'] ? snippet(firstSentence(p.sections['五大道居所'])) : snippet(p.summary, 90),
      rating: null,
    }));
    // Weave one recommended food/shopping stop into each day when available.
    if (shopItems.length) {
      const s = shopItems[shopIdx % shopItems.length];
      shopIdx += 1;
      items.push({
        kind: 'shop',
        title: s.title,
        address: s.address || '',
        category: s.category,
        why: s.summary ? firstSentence(s.summary) : (s.features || []).join('、'),
        snippet: snippet(s.summary, 90),
        rating: s.rating,
      });
    }
    result.push({
      day: d + 1,
      theme: dayThemes[d] || '自由探索',
      stops: items,
    });
  }
  return result;
}

function buildShops(shopRanked) {
  return shopRanked.slice(0, 6).map((r) => ({
    title: r.item.title,
    category: r.item.category,
    address: r.item.address || '',
    rating: r.item.rating,
    features: r.item.features || [],
    summary: snippet(r.item.summary, 140),
  }));
}

function buildEventCalendar({ actRanked, startDate, endDate, feedbackMap }) {
  const items = actRanked
    .filter((r) => dateOverlaps(r.item, startDate, endDate))
    .slice(0, 8)
    .map((r) => ({
      title: r.item.title,
      type: r.item.category,
      location: r.item.address || r.item.road || '',
      start: r.item.startDate,
      end: r.item.endDate,
      summary: firstSentence(r.item.summary),
      rating: feedbackMap[r.item.id] ? Number(feedbackMap[r.item.id].avg.toFixed(1)) : null,
    }));
  return { label: '节事日历', items, hasDates: !!(startDate && endDate) };
}

function buildDayThemes(interestLabels, days) {
  if (!interestLabels.length) return Array(days).fill('五大道漫步');
  const themes = [];
  for (let i = 0; i < days; i++) themes.push(interestLabels[i % interestLabels.length]);
  return themes;
}

function buildHistory(ranked, purpose) {
  return ranked
    .filter((r) => r.page.category === '20-research' && ['people', 'events'].includes(r.page.subcategory))
    .slice(0, 6)
    .map((r) => ({
      title: r.page.title,
      category: catLabel(r.page),
      date: r.page.meta.date || r.page.meta.born || '',
      summary: firstSentence(r.page.summary),
    }));
}

function buildArchitecture(ranked, pages) {
  const fromRanked = ranked
    .filter((r) => r.page.sections['五大道居所'] || r.page.tags.some((t) => ['建筑', '风貌'].includes(t)))
    .slice(0, 6)
    .map((r) => ({
      title: r.page.title,
      address: r.page.addresses[0] || '',
      snippet: snippet(r.page.sections['五大道居所'] || r.page.summary, 140),
    }));
  if (fromRanked.length >= 3) return fromRanked;
  // Fallback: pull from the architecture draft.
  const draft = pages.find((p) => p.id.includes('architecture-as-identity'));
  if (draft) fromRanked.push({ title: draft.title, address: '', snippet: snippet(draft.summary, 160) });
  return fromRanked;
}

function buildSeasonal({ pages, months, season }) {
  const historicalEvents = [];
  if (months.length) {
    for (const p of pages) {
      if (p.category === '20-research' && p.subcategory === 'events') {
        const hit = (p.eventMonths || []).find((m) => months.includes(m));
        if (hit) historicalEvents.push({ title: p.title, month: hit, summary: firstSentence(p.summary) });
      }
    }
  }
  const notes = SEASON_NOTES[season.key] || SEASON_NOTES.none;
  return { seasonLabel: season.label, notes, historicalEvents: historicalEvents.slice(0, 6) };
}

const SEASON_NOTES = {
  spring: [
    '春季（3–5 月）是五大道最佳游览季之一：海棠、樱花陆续绽放，街道绿荫初成，气温宜人。',
    '建议上午光线柔和时拍摄洋楼立面；午后可在民园广场周边咖啡馆小憩。',
    '春风较大，注意防风与保湿。',
  ],
  summer: [
    '夏季（6–8 月）炎热潮湿，午后多雷阵雨，建议避开正午暴晒，安排在早晚游览。',
    '五大道的林荫道与洋楼连廊能提供遮阴；随身携带雨具。',
    '可结合室内场馆（如近代历史展览）错峰参观。',
  ],
  autumn: [
    '秋季（9–11 月）被公认为五大道最宜人的季节：梧桐金黄、气候干爽，是摄影与漫步的黄金期。',
    '10 月前后常举办文化市集与历史主题导览活动，关注本地公告。',
    '昼夜温差渐大，备一件薄外套。',
  ],
  winter: [
    '冬季（12–2 月）寒冷干燥，游人较少，适合安静地品味街区建筑轮廓与历史氛围。',
    '雪后洋楼别有一番韵味，但注意路面防滑保暖。',
    '部分故居内部展陈冬季可能闭馆维护，出行前请确认开放时间。',
  ],
  none: [
    '五大道全年可游，春、秋两季气候与景观最佳。',
    '建议结合官方开放信息规划室内外动线。',
  ],
};

function collectSources(ranked) {
  const seen = new Set();
  const out = [];
  for (const r of ranked.slice(0, 18)) {
    for (const s of r.page.sources || []) {
      if (s.url && !seen.has(s.url)) {
        seen.add(s.url);
        out.push(s);
      }
    }
  }
  return out;
}

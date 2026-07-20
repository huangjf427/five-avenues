const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let META = null;
let CURRENT_USER = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

// T-M.2 前端埋点：统一经 /api/analytics 转发（服务端可控端点、避开 CORS）。
// 失败静默丢弃，绝不影响主流程。
function trackEvent(event, fields = {}) {
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ event, fields }),
  }).catch(() => {});
}

/* ============================ 初始化 ============================ */
async function init() {
  META = await api('/api/meta');


  // 行程表单
  const purposeSel = $('#purpose');
  META.purposes.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    purposeSel.appendChild(o);
  });
  const wrap = $('#interests');
  META.interests.forEach((it) => {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" value="${it.id}">${esc(it.label)}`;
    label.querySelector('input').addEventListener('change', (e) => {
      label.classList.toggle('active', e.target.checked);
    });
    wrap.appendChild(label);
  });

  // 评价对象下拉
  const targetSel = $('#reviewTarget');
  targetSel.innerHTML =
    '<option value="overall">五大道整体行程体验</option>' +
    (META.reviewTargets || [])
      .map((t) => `<option value="${t.type}:${esc(t.id)}" data-name="${esc(t.name)}">${t.type === 'shop' ? '店铺' : '活动'} · ${esc(t.name)}</option>`)
      .join('');

  setupStars();
  setupNav();
  setupAuth();
  setupReviewForm();
  setupAdmin();
  setupMyReviews();
  setupReportModal();

  await refreshUser();
  renderKbStatus(META);
  renderRagStatus(META);
}

// FR-8：在顶栏同步按钮旁展示知识库来源与可达状态。
function renderKbStatus(meta) {
  const el = $('#kbStatus');
  if (!el || !meta) return;
  if (meta.wikiStatus === 'degraded') {
    el.textContent = '⚠ 知识库不可用';
    el.className = 'kb-status warn';
    el.title = meta.wikiError || '知识库加载失败';
  } else if (meta.kbConfigured) {
    el.textContent = '外部知识库';
    el.className = 'kb-status ok';
    el.title = `知识库来源：${meta.wikiSource || ''}`;
  } else {
    el.textContent = '默认知识库';
    el.className = 'kb-status';
    el.title = `知识库来源：${meta.wikiSource || ''}（未配置 WUDADAO_KB_PATH）`;
  }
}

// FR-9：定制行程页 RAG 状态徽标 + 配置指引（未配置时置灰「AI 增强生成」）。
function renderRagStatus(meta) {
  const el = $('#ragStatus');
  const guide = $('#ragGuide');
  const cb = $('#useRag');
  if (!el || !meta) return;
  if (meta.ragAvailable) {
    el.textContent = '✅ AI 增强可用';
    el.className = 'rag-status ok';
    cb.disabled = false;
    if (guide) guide.hidden = true;
    return;
  }
  // 不可用：置灰选项 + 展示原因与配置指引入口。
  cb.disabled = true;
  cb.checked = false;
  el.textContent = '⚪ AI 增强不可用';
  el.className = 'rag-status off';
  const reason = meta.ragUnavailableReason || 'RAG 未就绪';
  el.title = reason;
  if (!guide) return;
  guide.hidden = false;
  guide.innerHTML = `
    <span class="rag-reason">${esc(reason)}</span>
    <button id="ragGuideBtn" class="link-btn" type="button">查看配置指引</button>`;
  const btn = $('#ragGuideBtn');
  if (btn) btn.addEventListener('click', () => {
    trackEvent('rag_config_view', { entry: 'config_guide' });
    guide.innerHTML = `<p class="note">${esc(meta.ragConfigGuide || '')}</p>`;
  });
}

/* ============================ 导航 ============================ */
function setupNav() {
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(view) {
  // 访问控制：未登录禁止进入「我的评价」；非管理员禁止进入「审核后台」。
  // 即使按钮被隐藏，这里也作为纵深防御拦截直接调用。
  if (view === 'my-reviews' && !CURRENT_USER) view = 'guide';
  if (view === 'admin' && !(CURRENT_USER && CURRENT_USER.role === 'admin')) view = 'guide';

  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'wiki') loadReviews();
  if (view === 'admin') loadAdmin();
  if (view === 'my-reviews') loadMyReviews();
  trackEvent('page_view', {
    view,
    user_role: !CURRENT_USER ? 'visitor' : CURRENT_USER.role === 'admin' ? 'admin' : 'user',
  });
}

/* ============================ 账号 ============================ */
function setupAuth() {
  const modal = $('#authModal');
  const overlay = modal; // the modal div is the overlay

  function open() {
    modal.hidden = false;
    $('#authError').textContent = '';
    $('#authUser').value = '';
    $('#authPass').value = '';
    // Focus the username input for accessibility
    setTimeout(() => $('#authUser').focus(), 50);
  }

  function close() {
    modal.hidden = true;
  }

  // 登录按钮
  $('#authBtn').addEventListener('click', open);

  // 游客 Wiki 中的「登录 / 注册」引导按钮
  const wikiLoginBtn = $('#wikiLoginBtn');
  if (wikiLoginBtn) wikiLoginBtn.addEventListener('click', open);

  // 关闭按钮 — 用委托确保可靠
  $('#authClose').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  // 点击遮罩关闭（排除弹窗卡片内部）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // ESC 键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  let mode = 'login';
  $$('.mtab').forEach((t) => t.addEventListener('click', () => {
    mode = t.dataset.mode;
    $$('.mtab').forEach((x) => x.classList.toggle('active', x === t));
    $('#authSubmit').textContent = mode === 'login' ? '登录' : '注册';
    $('#authError').textContent = '';
  }));

  $('#authSubmit').addEventListener('click', async () => {
    const username = $('#authUser').value.trim();
    const password = $('#authPass').value;
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const data = await api(path, { method: 'POST', body: JSON.stringify({ username, password }) });
      CURRENT_USER = data.user;
      close();
      $('#authPass').value = '';
      applyUser();
    } catch (e) {
      $('#authError').textContent = e.message;
    }
  });

  // Enter 键提交
  $('#authPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#authSubmit').click();
  });
  $('#authUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#authPass').focus();
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    CURRENT_USER = null;
    applyUser();
    showView('guide');
  });
}

async function refreshUser() {
  try {
    const data = await api('/api/auth/me');
    CURRENT_USER = data.user;
  } catch { CURRENT_USER = null; }
  applyUser();
}

function applyUser() {
  const loggedIn = !!CURRENT_USER;
  const isAdmin = loggedIn && CURRENT_USER.role === 'admin';
  $('#userLabel').textContent = loggedIn ? `${CURRENT_USER.username}${isAdmin ? '（管理员）' : ''}` : '';
  $('#authBtn').hidden = loggedIn;
  $('#logoutBtn').hidden = !loggedIn;

  // 未登录时隐藏「我的评价」「评价审核后台」导航按钮（安全兜底）。
  // 用 querySelectorAll 处理所有 admin-only 元素，避免漏掉。
  $$('.admin-only').forEach((el) => { el.hidden = !isAdmin; });
  const myReviewsBtn = document.querySelector('[data-view="my-reviews"]');
  if (myReviewsBtn) myReviewsBtn.hidden = !loggedIn;

  // 未登录时强制隐藏对应视图面板，防止通过历史记录/直接调用进入。
  const myReviewsView = $('#view-my-reviews');
  const adminView = $('#view-admin');
  if (myReviewsView && !loggedIn) myReviewsView.hidden = true;
  if (adminView && !isAdmin) adminView.hidden = true;

  // 游客 Wiki：未登录时隐藏「写评价」表单，改显示登录引导；登录后展示表单
  const formPanel = $('#reviewFormPanel');
  const loginPrompt = $('#reviewLoginPrompt');
  if (formPanel) formPanel.hidden = !loggedIn;
  if (loginPrompt) loginPrompt.hidden = loggedIn;

  // 匿名选项文案
  const hint = $('#anonHint');
  if (loggedIn) {
    hint.textContent = `匿名发布（不显示用户名「${CURRENT_USER.username}」）`;
    $('#reviewAnon').disabled = false;
  } else {
    hint.textContent = '未登录将以「匿名游客」发布';
    $('#reviewAnon').checked = true;
    $('#reviewAnon').disabled = true;
  }
}

/* ============================ 行程生成 ============================ */
function selectedInterests() {
  return $$('#interests input:checked').map((i) => i.value);
}

async function generate() {
  const status = $('#status');
  status.textContent = '正在生成…';
  status.className = 'status';
  const btn = $('#generateBtn');
  btn.disabled = true;

  const payload = {
    purposeId: $('#purpose').value,
    interests: selectedInterests(),
    startDate: $('#startDate').value || '',
    endDate: $('#endDate').value || '',
    useRag: document.querySelector('#useRag')?.checked || false,
  };

  try {
    const guide = await api('/api/guide', { method: 'POST', body: JSON.stringify(payload) });
    renderGuide(guide);
    let msg = `已生成 · 美食·购物 ${guide.shops.length} 处 · 节事 ${guide.eventCalendar.items.length} 项`;
    if (guide.rag === true) msg += ' · AI 增强生成';
    else if (guide.ragDegraded) msg += ' · 已切换为常规生成（AI 增强暂不可用）';
    status.textContent = msg;
    // T-M.2 前端埋点 guide_generate（双写以服务端为准的字段不在此重复）。
    trackEvent('guide_generate', {
      purpose_id: payload.purposeId,
      interests: payload.interests,
      use_rag: !!payload.useRag,
      rag_available: META.ragAvailable,
      source: guide.rag ? 'rag' : 'rule',
      success: true,
      guide_days: guide.meta ? guide.meta.days : 0,
    });
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status error';
    trackEvent('guide_generate', { success: false, fail_reason: e.message });
  } finally {
    btn.disabled = false;
  }
}

function ratingHtml(r) {
  if (r == null) return '';
  return `<span class="rating">★ ${Number(r).toFixed(1)}</span>`;
}

function renderGuide(g) {
  const meta = g.meta;
  const tags = [meta.purposeLabel, ...meta.interestLabels, `${meta.days} 天`, meta.seasonLabel]
    .map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const overview = `<p>${esc(g.overview).replace(/\n/g, '<br>')}</p>`;

  const itinerary = g.itinerary.map((d) => `
    <div class="day-card">
      <div class="day-head"><span class="d">第 ${d.day} 天</span><span class="t">${esc(d.theme)}</span></div>
      ${d.stops.map((s) => `
        <div class="stop ${s.kind === 'shop' ? 'stop-shop' : ''}">
          <div class="name">${esc(s.title)} ${s.kind === 'shop' ? '<span class="badge">美食·购物</span>' : ''} <span class="addr">· ${esc(s.category)}${s.address ? ' · ' + esc(s.address) : ''}${s.rating ? ' · ' + ratingHtml(s.rating) : ''}</span></div>
          <div class="why">${esc(s.why)}</div>
        </div>`).join('')}
    </div>`).join('');

  const history = g.history.length ? `
    <div class="card-list">
      ${g.history.map((h) => `
        <div class="card">
          <div class="ct"><span>${esc(h.title)}</span><span class="cmeta">${esc(h.category)} ${esc(h.date)}</span></div>
          <div class="cbody">${esc(h.summary)}</div>
        </div>`).join('')}
    </div>` : '<p class="note">暂无匹配的历史条目，调整兴趣或目的后重试。</p>';

  const arch = g.architecture.length ? `
    <div class="card-list">
      ${g.architecture.map((a) => `
        <div class="card">
          <div class="ct"><span>${esc(a.title)}</span><span class="cmeta">${esc(a.address)}</span></div>
          <div class="cbody">${esc(a.snippet)}</div>
        </div>`).join('')}
    </div>` : '<p class="note">暂无匹配的建筑条目。</p>';

  const shops = g.shops && g.shops.length ? `
    <div class="card-list">
      ${g.shops.map((s) => `
        <div class="card">
          <div class="ct"><span>${esc(s.title)} <span class="badge">${esc(s.category)}</span></span><span class="cmeta">${esc(s.address)}${s.rating ? ' · ' + ratingHtml(s.rating) : ''}</span></div>
          <div class="cbody">${esc(s.summary)}</div>
          ${s.features && s.features.length ? '<div class="feats">' + s.features.map((f) => `<span class="feat">${esc(f)}</span>`).join('') + '</div>' : ''}
        </div>`).join('')}
    </div>` : '<p class="note">暂无可推荐的美食·购物站点，选择「美食餐饮」「购物休闲」兴趣后重试。</p>';

  const cal = g.eventCalendar || { items: [] };
  const calendar = cal.items && cal.items.length ? `
    <div class="card-list">
      ${cal.items.map((a) => `
        <div class="cal-card card">
          <div class="ct"><span>${esc(a.title)} <span class="badge badge-act">${esc(a.type)}</span></span><span class="cmeta">${esc(a.location)}${a.rating ? ' · ' + ratingHtml(a.rating) : ''}</span></div>
          <div class="cal-date">${esc(a.start)} 至 ${esc(a.end)}</div>
          <div class="cbody">${esc(a.summary)}</div>
        </div>`).join('')}
    </div>` : '<p class="note">所选日期窗口内暂无匹配的本地活动，可放宽日期或更换季节后再试。</p>';

  const seasonal = `
    ${g.seasonal.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    ${g.seasonal.historicalEvents.length ? '<h4 style="margin:14px 0 6px">行程月份的历史事件</h4>' + g.seasonal.historicalEvents.map((e) => `<p class="note"><b>${esc(e.title)}</b>（${e.month} 月）— ${esc(e.summary)}</p>`).join('') : ''}
  `;

  // FR-10：溯源展示。RAG 生成标注「可溯源」并支持展开来源片段；规则生成标注「规则推荐」。
  const ragBadge = g.rag === true
    ? '<span class="badge">AI 增强 · 可溯源</span>'
    : '<span class="badge badge-act">规则推荐</span>';
  const srcList = (g.sources && g.sources.length)
    ? `<details class="src-details"><summary>资料来源（${g.sources.length} 条，点击展开）</summary>
        <ul class="src-list">${g.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener" data-src="${esc(s.url)}">${esc(s.title)}</a></li>`).join('')}</ul>
      </details>`
    : '<p class="note">本指南条目暂未标注外部来源。</p>';
  const sources = `<div class="sources">${ragBadge}${srcList}</div>`;

  $('#guide').className = 'guide';
  $('#guide').innerHTML = `
    <div class="toolbar">
      <button onclick="window.print()">🖨 打印 / 导出 PDF</button>
    </div>
    <div class="meta-bar">${tags}</div>
    <p class="cmeta">${esc(meta.dateLabel)}</p>

    <div class="section"><h3>行程概览</h3>${overview}</div>
    <div class="section"><h3>逐日行程</h3>${itinerary || '<p class="note">暂无可步行参访的故居点位，建议调整兴趣方向。</p>'}</div>
    <div class="section"><h3>历史与人物</h3>${history}</div>
    <div class="section"><h3>建筑与风貌</h3>${arch}</div>
    <div class="section"><h3>美食与购物</h3>${shops}</div>
    <div class="section"><h3>节事日历</h3>${calendar}</div>
    <div class="section"><h3>季节与节事</h3>${seasonal}</div>
    <div class="section"><h3>资料来源</h3>${sources}</div>
  `;

  // FR-10：资料来源链接点击埋点。
  $$('#guide a[data-src]').forEach((a) => a.addEventListener('click', () => {
    trackEvent('guide_source_click', { source_id: a.dataset.src });
  }));
}

/* ============================ 评分星标 ============================ */
function setupStars() {
  const box = $('#ratingStars');
  const stars = [...box.querySelectorAll('span')];
  const paint = (v) => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
  stars.forEach((s) => {
    s.addEventListener('mouseenter', () => paint(Number(s.dataset.v)));
    s.addEventListener('click', () => { box.dataset.value = s.dataset.v; paint(Number(s.dataset.v)); });
  });
  box.addEventListener('mouseleave', () => paint(Number(box.dataset.value)));
}

/* ============================ 提交评价 ============================ */
function setupReviewForm() {
  $('#submitReviewBtn').addEventListener('click', async () => {
    const status = $('#reviewStatus');
    const rating = Number($('#ratingStars').dataset.value);
    const targetVal = $('#reviewTarget').value;
    let targetType = 'overall', targetId = null, targetName = null;
    if (targetVal !== 'overall') {
      const [type, id] = targetVal.split(':');
      targetType = type; targetId = id;
      const opt = $('#reviewTarget').selectedOptions[0];
      targetName = opt ? opt.dataset.name : null;
    }
    const payload = {
      rating,
      title: $('#reviewTitle').value,
      body: $('#reviewBody').value,
      tags: $('#reviewTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      targetType, targetId, targetName,
      anonymous: $('#reviewAnon').checked,
    };
    status.className = 'status';
    status.textContent = '提交中…';
    try {
      const data = await api('/api/reviews', { method: 'POST', body: JSON.stringify(payload) });
      status.textContent = data.message;
      $('#reviewTitle').value = '';
      $('#reviewBody').value = '';
      $('#reviewTags').value = '';
      $('#ratingStars').dataset.value = '0';
      starsOff();
    } catch (e) {
      status.className = 'status error';
      status.textContent = e.message;
    }
  });
}

function starsOff() {
  $$('#ratingStars span').forEach((s) => s.classList.remove('on'));
}

/* ============================ 举报弹窗（FR-12） ============================ */
let REPORT_REVIEW_ID = null;

function setupReportModal() {
  const modal = $('#reportModal');
  if (!modal) return;
  const sel = $('#reportReason');
  if (sel && META && META.reportReasons) {
    sel.innerHTML = META.reportReasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  }
  $('#reportClose').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $('#submitReportBtn').addEventListener('click', async () => {
    if (!REPORT_REVIEW_ID) return;
    const status = $('#reportStatus');
    const reason = $('#reportReason').value;
    status.className = 'status';
    status.textContent = '提交中…';
    try {
      const data = await api(`/api/reviews/${REPORT_REVIEW_ID}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
      status.textContent = data.message;
      modal.hidden = true;
      REPORT_REVIEW_ID = null;
    } catch (e) {
      status.className = 'status error';
      status.textContent = e.message;
    }
  });
}

function openReport(id) {
  REPORT_REVIEW_ID = id;
  $('#reportStatus').textContent = '';
  $('#reportModal').hidden = false;
}

/* ============================ 评价墙 ============================ */
function starBar(r) {
  return '★★★★★☆☆☆☆☆'.slice(5 - r, 10 - r);
}

async function loadReviews() {
  const list = $('#reviewList');
  list.innerHTML = '<p class="guide-empty">加载中…</p>';
  try {
    const { items } = await api('/api/reviews');
    $('#reviewCount').textContent = `${items.length} 条已通过评价`;
    if (!items.length) {
      list.innerHTML = '<p class="guide-empty">还没有已通过的评价，快来成为第一个分享的人！</p>';
      return;
    }
    list.innerHTML = items.map(renderReviewCard).join('');
    $$('#reviewList .helpful').forEach((b) => b.addEventListener('click', () => onHelpful(b)));
    $$('#reviewList .report-link').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.id)));
  } catch (e) {
    list.innerHTML = `<p class="status error">${esc(e.message)}</p>`;
  }
}

function targetLabel(r) {
  if (r.targetType === 'overall') return '五大道整体体验';
  return `${r.targetType === 'shop' ? '店铺' : '活动'} · ${esc(r.targetName || '')}`;
}

function renderReviewCard(r) {
  const date = new Date(r.createdAt).toLocaleDateString('zh-CN');
  const tags = (r.tags || []).map((t) => `<span class="feat">${esc(t)}</span>`).join('');
  const count = r.helpfulCount || 0;
  // FR-11：登录用户可投票（显示已投状态）；匿名仅可见计数。
  const helpfulBtn = CURRENT_USER
    ? `<button class="mini helpful ${r.votedByMe ? 'voted' : ''}" data-id="${r.id}">👍 有用 ${count}</button>`
    : `<span class="cmeta">👍 ${count}</span>`;
  // FR-12：已通过评价 + 登录用户可举报。
  const reportBtn = CURRENT_USER
    ? `<button class="mini report-link" data-id="${r.id}">举报</button>`
    : '';
  return `
    <div class="card review-card">
      <div class="ct">
        <span>${r.title ? esc(r.title) : '<span class="cmeta">（无标题）</span>'}
          <span class="stars-inline">${starBar(r.rating)}</span></span>
        <span class="cmeta">${esc(targetLabel(r))}</span>
      </div>
      <div class="cbody">${esc(r.body).replace(/\n/g, '<br>')}</div>
      ${tags ? `<div class="feats">${tags}</div>` : ''}
      <div class="cmeta review-foot">— ${esc(r.authorName)} · ${date}</div>
      <div class="review-actions">${helpfulBtn}${reportBtn}</div>
    </div>`;
}

// FR-11：点击「有用」→ 切换投票，更新计数与已投状态（不整页刷新）。
async function onHelpful(btn) {
  const id = btn.dataset.id;
  btn.disabled = true;
  try {
    const data = await api(`/api/reviews/${id}/helpful`, { method: 'POST' });
    btn.textContent = `👍 有用 ${data.helpfulCount}`;
    btn.classList.toggle('voted', data.voted);
  } catch (e) {
    alert('操作失败：' + e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ============================ 我的评价 ============================ */
function setupMyReviews() {
  // No event listeners needed — purely loaded on tab switch.
}

async function loadMyReviews() {
  if (!CURRENT_USER) {
    $('#myReviewList').innerHTML = '<p class="guide-empty">请先登录后查看。</p>';
    return;
  }
  const list = $('#myReviewList');
  list.innerHTML = '<p class="guide-empty">加载中…</p>';
  try {
    const { items } = await api('/api/my-reviews');
    $('#myReviewCount').textContent = `${items.length} 条评价`;
    if (!items.length) {
      list.innerHTML = '<p class="guide-empty">你还没有发表过评价。</p>';
      return;
    }
    list.innerHTML = items.map(renderMyReviewCard).join('');
  } catch (e) {
    list.innerHTML = `<p class="status error">${esc(e.message)}</p>`;
  }
}

function statusDot(status) {
  const map = {
    pending: ['⏳ 待审核', 'badge-act'],
    approved: ['✅ 已通过', ''],
    rejected: ['❌ 已拒绝', 'badge-rej'],
  };
  const [txt, cls] = map[status] || [status, ''];
  return `<span class="badge ${cls}">${txt}</span>`;
}

function renderMyReviewCard(r) {
  const date = new Date(r.createdAt).toLocaleDateString('zh-CN');
  const t = r.targetType === 'overall' ? '整体体验' : `${r.targetType === 'shop' ? '店铺' : '活动'} · ${esc(r.targetName || r.targetId || '')}`;
  const rejectNote = r.status === 'rejected' && r.moderationNote
    ? `<p class="note" style="margin-top:6px"><b>审核意见：</b>${esc(r.moderationNote)}</p>`
    : '';
  return `
    <div class="card review-card">
      <div class="ct">
        <span>${r.title ? esc(r.title) : '<span class="cmeta">（无标题）</span>'}
          <span class="stars-inline">${starBar(r.rating)}</span> ${statusDot(r.status)}</span>
        <span class="cmeta">${esc(t)}</span>
      </div>
      <div class="cbody">${esc(r.body).replace(/\n/g, '<br>')}</div>
      ${rejectNote}
      <div class="cmeta review-foot">— ${esc(r.anonymous ? '匿名游客' : r.authorName)} · ${date} · 👍 ${r.helpfulCount || 0}</div>
    </div>`;
}

/* ============================ 审核后台 ============================ */
let ADMIN_STATUS = 'pending';
let ADMIN_MODE = 'reviews'; // 'reviews' | 'reports'

function setupAdmin() {
  $$('#adminFilter .tab').forEach((t) => t.addEventListener('click', () => {
    $$('#adminFilter .tab').forEach((x) => x.classList.toggle('active', x === t));
    if (t.dataset.mode === 'reports') {
      ADMIN_MODE = 'reports';
      ADMIN_STATUS = '';
    } else {
      ADMIN_MODE = 'reviews';
      ADMIN_STATUS = t.dataset.status || '';
    }
    loadAdmin();
  }));

  // FR-13.2 批量通过 / 拒绝（单条失败不中断整批）。
  $('#batchApproveBtn').addEventListener('click', () => doBatch('approve'));
  $('#batchRejectBtn').addEventListener('click', () => doBatch('reject'));
  $('#batchSelAll').addEventListener('change', (e) => {
    $$('#adminList .batch-sel').forEach((c) => (c.checked = e.target.checked));
    updateBatchCount();
  });
}

function updateBatchCount() {
  const n = $$('#adminList .batch-sel:checked').length;
  $('#batchCount').textContent = `已选 ${n} 条`;
  $('#adminBatchBar').hidden = ADMIN_MODE !== 'reviews' || n === 0;
}

async function doBatch(action) {
  const ids = $$('#adminList .batch-sel:checked').map((c) => c.dataset.id);
  if (!ids.length) return;
  if (!confirm(`确认批量${action === 'approve' ? '通过' : '拒绝'} ${ids.length} 条评价？`)) return;
  try {
    const r = await api('/api/admin/reviews/batch', { method: 'POST', body: JSON.stringify({ ids, action }) });
    let msg = `成功 ${r.succeeded.length} 条`;
    if (r.failed.length) msg += `，失败 ${r.failed.length} 条（${r.failed.map((f) => f.error).join('；')}）`;
    alert(msg);
    loadAdmin();
  } catch (e) {
    alert('批量操作失败：' + e.message);
  }
}

async function loadAdmin() {
  const list = $('#adminList');
  list.innerHTML = '<p class="guide-empty">加载中…</p>';
  $('#adminBatchBar').hidden = true;
  try {
    if (ADMIN_MODE === 'reports') {
      const { items, counts } = await api('/api/admin/reports');
      $('#cnt-reports').textContent = counts.pending;
      if (!items.length) {
        list.innerHTML = '<p class="guide-empty">暂无举报工单。</p>';
        return;
      }
      list.innerHTML = items.map(renderReportCard).join('');
      $$('#adminList [data-resolve]').forEach((btn) => btn.addEventListener('click', () => {
        doResolve(btn.dataset.id, btn.dataset.resolve);
      }));
      return;
    }
    const q = ADMIN_STATUS ? `?status=${ADMIN_STATUS}` : '';
    const { items, counts } = await api(`/api/admin/reviews${q}`);
    $('#cnt-pending').textContent = counts.pending;
    $('#cnt-approved').textContent = counts.approved;
    $('#cnt-rejected').textContent = counts.rejected;
    if (!items.length) {
      list.innerHTML = '<p class="guide-empty">该分类下暂无评价。</p>';
      return;
    }
    list.innerHTML = items.map(renderAdminCard).join('');
    $$('#adminList [data-act]').forEach((btn) => btn.addEventListener('click', () => {
      doModerate(btn.dataset.id, btn.dataset.act);
    }));
    $$('#adminList .batch-sel').forEach((c) => c.addEventListener('change', updateBatchCount));
    updateBatchCount();
  } catch (e) {
    list.innerHTML = `<p class="status error">${esc(e.message)}</p>`;
  }
}

async function doResolve(id, decision) {
  const note = prompt(decision === 'dismiss' ? '下架原因（可选）：' : '驳回理由（可选）：') || '';
  try {
    await api(`/api/admin/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ decision, note }) });
    loadAdmin();
  } catch (e) {
    alert('操作失败：' + e.message);
  }
}

// FR-13.1：举报工单卡片。
function renderReportCard(r) {
  const date = new Date(r.createdAt).toLocaleString('zh-CN');
  const statusText = { pending: '待处理', resolved: '已采纳下架', dismissed: '已驳回举报' }[r.status] || r.status;
  const resolveBtns = r.status === 'pending'
    ? `<button class="mini approve" data-resolve="uphold" data-id="${r.id}">维持评价（驳回举报）</button>
       <button class="mini reject" data-resolve="dismiss" data-id="${r.id}">下架评价（采纳举报）</button>`
    : `<span class="cmeta">${esc(r.resolvedBy || '')} 于 ${r.resolvedAt ? new Date(r.resolvedAt).toLocaleString('zh-CN') : ''} · 决定：${r.decision === 'dismiss' ? '采纳下架' : '驳回举报'}</span>`;
  return `
    <div class="card review-card">
      <div class="ct">
        <span><b>举报原因：</b>${esc(r.reason)}</span>
        <span class="cmeta">${statusText}</span>
      </div>
      <div class="cbody">
        <div class="feats"><span class="feat">被举报评价：${esc(r.reviewTitle || '(已删除)')}</span></div>
        ${r.reviewExcerpt ? `<p class="note">${esc(r.reviewExcerpt)}</p>` : ''}
        <p class="note">举报人：${esc(r.reporterName)} · ${date}${r.reviewFlagged ? ' · ⚠ 命中敏感词' : ''}</p>
      </div>
      <div class="review-foot"><span class="mod-actions">${resolveBtns}</span></div>
    </div>`;
}

function statusBadge(s) {
  const map = { pending: ['待审核', 'badge-act'], approved: ['已通过', ''], rejected: ['已拒绝', 'badge-rej'] };
  const [txt, cls] = map[s] || [s, ''];
  return `<span class="badge ${cls}">${txt}</span>`;
}

function renderAdminCard(r) {
  const date = new Date(r.createdAt).toLocaleString('zh-CN');
  const author = r.anonymous ? '匿名游客' : (r.authorName || '匿名游客');
  const tags = (r.tags || []).map((t) => `<span class="feat">${esc(t)}</span>`).join('');
  const t = r.targetType === 'overall' ? '整体体验' : `${r.targetType === 'shop' ? '店铺' : '活动'} · ${esc(r.targetName || r.targetId || '')}`;
  const actions = r.status === 'pending'
    ? `<button class="mini approve" data-act="approve" data-id="${r.id}">通过</button>
       <button class="mini reject" data-act="reject" data-id="${r.id}">拒绝</button>`
    : `<span class="cmeta">${esc(r.reviewedBy || '')} 于 ${r.reviewedAt ? new Date(r.reviewedAt).toLocaleString('zh-CN') : ''}
       ${r.status === 'approved'
         ? `<button class="mini reject" data-act="reject" data-id="${r.id}">改为拒绝</button>`
         : `<button class="mini approve" data-act="approve" data-id="${r.id}">改为通过</button>`}</span>`;

  // Moderation note textarea for rejection
  const noteArea = r.status === 'pending'
    ? `<textarea class="mod-note" data-id="${r.id}" rows="2" placeholder="拒绝时可填写原因（审核通过后也会保留此备注）" style="display:none;margin-top:6px;width:100%"></textarea>`
    : (r.moderationNote ? `<p class="note" style="margin-top:6px"><b>审核意见：</b>${esc(r.moderationNote)}</p>` : '');

  return `
    <div class="card review-card">
      <label class="batch-cell"><input type="checkbox" class="batch-sel" data-id="${r.id}"></label>
      <div class="ct">
        <span>${r.title ? esc(r.title) : '<span class="cmeta">（无标题）</span>'}
          <span class="stars-inline">${starBar(r.rating)}</span> ${statusBadge(r.status)} ${r.flagged ? '<span class="badge badge-rej">⚠ 敏感词</span>' : ''}</span>
        <span class="cmeta">${esc(t)}</span>
      </div>
      <div class="cbody">${esc(r.body).replace(/\n/g, '<br>')}</div>
      ${tags ? `<div class="feats">${tags}</div>` : ''}
      ${noteArea}
      <div class="review-foot">
        <span class="cmeta">${esc(author)} · ${date}</span>
        <span class="mod-actions">${actions}</span>
      </div>
    </div>`;
}

async function doModerate(id, action) {
  // Gather moderation note if present
  const noteEl = document.querySelector(`.mod-note[data-id="${id}"]`);
  const note = noteEl ? noteEl.value.trim() : '';

  // Toggle textarea visibility
  if (noteEl) {
    noteEl.style.display = noteEl.style.display === 'none' ? 'block' : 'none';
    if (noteEl.style.display === 'block') {
      noteEl.focus();
      return; // User needs to type note then click reject again
    }
  }

  try {
    await api(`/api/admin/reviews/${id}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    });
    loadAdmin();
  } catch (e) {
    alert('操作失败：' + e.message);
  }
}

/* ============================ 事件绑定 ============================ */
$('#generateBtn').addEventListener('click', generate);
$('#reloadBtn').addEventListener('click', async () => {
  const r = await api('/api/reload', { method: 'POST' });
  let msg = r.ok ? `知识库已同步（${r.wikiCount} 篇）` : '同步失败';
  if (r.wikiStatus === 'degraded') msg = `⚠ 知识库不可用，已降级：${r.wikiError || ''}`;
  if (r.ragRebuild === 'started') msg += ' · RAG 索引重建中…';
  $('#status').textContent = msg;
  renderKbStatus(r);
});

init();

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

  await refreshUser();
}

/* ============================ 导航 ============================ */
function setupNav() {
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(view) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'wiki') loadReviews();
  if (view === 'admin') loadAdmin();
  if (view === 'my-reviews') loadMyReviews();
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
  $('.admin-only').hidden = !isAdmin;
  // Show/hide "My Reviews" tab
  const myReviewsBtn = document.querySelector('[data-view="my-reviews"]');
  if (myReviewsBtn) myReviewsBtn.hidden = !loggedIn;

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
  };

  try {
    const guide = await api('/api/guide', { method: 'POST', body: JSON.stringify(payload) });
    renderGuide(guide);
    status.textContent = `已生成 · 美食·购物 ${guide.shops.length} 处 · 节事 ${guide.eventCalendar.items.length} 项`;
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status error';
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

  const sources = g.sources.length ? `
    <div class="sources">
      ${g.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ')}
    </div>` : '';

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
    <div class="section"><h3>资料来源</h3>${sources || '<p class="note">本指南条目暂未标注外部来源。</p>'}</div>
  `;
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
    </div>`;
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
      <div class="cmeta review-foot">— ${esc(r.anonymous ? '匿名游客' : r.authorName)} · ${date}</div>
    </div>`;
}

/* ============================ 审核后台 ============================ */
let ADMIN_STATUS = 'pending';

function setupAdmin() {
  $$('#adminFilter .tab').forEach((t) => t.addEventListener('click', () => {
    ADMIN_STATUS = t.dataset.status;
    $$('#adminFilter .tab').forEach((x) => x.classList.toggle('active', x === t));
    loadAdmin();
  }));
}

async function loadAdmin() {
  const list = $('#adminList');
  list.innerHTML = '<p class="guide-empty">加载中…</p>';
  try {
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
  } catch (e) {
    list.innerHTML = `<p class="status error">${esc(e.message)}</p>`;
  }
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
      <div class="ct">
        <span>${r.title ? esc(r.title) : '<span class="cmeta">（无标题）</span>'}
          <span class="stars-inline">${starBar(r.rating)}</span> ${statusBadge(r.status)}</span>
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
  $('#status').textContent = r.ok ? `知识库已同步（${r.wikiCount} 篇）` : '同步失败';
});

init();

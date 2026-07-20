import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWiki, getWikiRoot } from './src/wiki.js';
import { loadExtra } from './src/data.js';
import { buildGuide } from './src/generator.js';
import { INTERESTS, PURPOSES } from './src/recommender.js';
import { register, login, logout, userFromToken, ensureAdmin } from './src/auth.js';
import { createReview, listApproved, listForAdmin, moderate, counts, readAllReviews, toggleHelpful, batchModerate } from './src/reviews.js';
import { createReport, listReports, reportCounts, resolveReport, reportReasons } from './src/reports.js';
import { track } from './src/analytics.js';
import { buildGuideRag } from './rag/generate.js';
import { hasRagCreds } from './rag/embed.js';
import { buildRagIndex } from './rag/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

// 极简零依赖 .env 加载（读取 <repo>/.env，不引入 dotenv 依赖）
function loadDotEnv() {
  try {
    const txt = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {}
}
loadDotEnv();

const PORT = process.env.PORT || 3000;

// ---- RAG 向量索引（离线 `node app/rag/index.js` 生成；运行时惰性加载）----
let ragIndex = null;
let ragIndexLoading = null;
const RAG_INDEX_FILE = join(__dirname, 'data', 'rag-index.json');
async function getRagIndex() {
  if (ragIndex) return ragIndex;
  if (!hasRagCreds()) return null;
  if (!ragIndexLoading) {
    ragIndexLoading = (async () => {
      try {
        const text = await readFile(RAG_INDEX_FILE, 'utf8');
        ragIndex = JSON.parse(text);
        return ragIndex;
      } catch {
        return null;
      }
    })();
  }
  const result = await ragIndexLoading;
  // 如果加载失败，允许下次请求重试（例如离线建库后无需重启服务）。
  if (!result) ragIndexLoading = null;
  return result;
}

// FR-8：知识库可配置化 + 不可达时优雅降级（不静默失败）。
let wikiCache = null;
let wikiLoading = null;
let wikiError = null;
let wikiSource = getWikiRoot();

async function getWiki() {
  if (wikiCache) return wikiCache;
  if (!wikiLoading) {
    wikiLoading = (async () => {
      wikiSource = getWikiRoot();
      try {
        const pages = await loadWiki();
        wikiCache = pages;
        wikiError = null;
        return pages;
      } catch (e) {
        // 知识库不可达：降级到本地 data/*.json 规则生成，但明确记录错误状态。
        wikiError = e.message;
        console.error('[wiki] 知识库加载失败，降级到本地数据：', e.message);
        wikiCache = [];
        return [];
      }
    })();
  }
  return wikiLoading;
}

let extraCache = null;
let extraLoading = null;

async function getExtra() {
  if (extraCache) return extraCache;
  if (!extraLoading) extraLoading = loadExtra().then((e) => { extraCache = e; return e; });
  return extraLoading;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

// ---- session cookie helpers ----
const COOKIE = 'fa_session';

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, maxAgeSec) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join('; ');
}

async function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  return userFromToken(token);
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);

  // ---------- existing itinerary APIs ----------
  if (req.method === 'GET' && url === '/api/meta') {
    const [wiki, extra] = await Promise.all([getWiki(), getExtra()]);
    // FR-9：RAG 可用状态 = 已配密钥 且 索引存在。缺任一项则给出明确原因与配置指引。
    let ragIndexExists = false;
    if (hasRagCreds()) {
      try { ragIndexExists = !!(await getRagIndex()); } catch { ragIndexExists = false; }
    }
    const ragAvailable = hasRagCreds() && ragIndexExists;
    const ragUnavailableReason = !hasRagCreds()
      ? '未配置 RAG_API_KEY'
      : !ragIndexExists
        ? 'RAG 索引缺失（请运行 npm run rag:index 生成）'
        : '';
    const ragConfigGuide =
      '在 .env 配置 RAG_API_KEY（及 RAG_BASE_URL / RAG_EMBED_MODEL 等），然后运行 npm run rag:index 生成向量索引。';
    return sendJSON(res, 200, {
      interests: INTERESTS,
      purposes: PURPOSES,
      wikiCount: wiki.length,
      shopCount: extra.shops.length,
      activityCount: extra.activities.length,
      ragEnabled: hasRagCreds(),
      ragIndexExists,
      ragAvailable,
      ragUnavailableReason,
      ragConfigGuide,
      // FR-8：向前端暴露知识库来源与可达状态
      kbConfigured: !!process.env.WUDADAO_KB_PATH,
      wikiSource,
      wikiStatus: wikiError ? 'degraded' : 'ok',
      wikiError: wikiError || null,
      reviewTargets: [
        ...extra.shops.map((s) => ({ id: s.id, name: s.title, type: 'shop' })),
        ...extra.activities.map((a) => ({ id: a.id, name: a.title, type: 'activity' })),
      ],
      reportReasons: reportReasons(),
    });
  }

  if (req.method === 'POST' && url === '/api/guide') {
    const input = await readBody(req);
    const [wiki, extra] = await Promise.all([getWiki(), getExtra()]);
    const useRag = !!input.useRag && hasRagCreds();
    let rag = false;
    let ragDegraded = false;
    try {
      if (useRag) {
        const index = await getRagIndex();
        if (index) {
          const guide = await buildGuideRag({
            pages: wiki,
            shops: extra.shops,
            activities: extra.activities,
            feedbackMap: extra.feedbackMap,
            purposeId: input.purposeId,
            interests: Array.isArray(input.interests) ? input.interests : [],
            startDate: input.startDate,
            endDate: input.endDate,
            index,
          });
          guide.rag = true;
          return sendJSON(res, 200, guide);
        }
        ragDegraded = true; // 已配密钥但索引缺失 → 降级
      }
    } catch (err) {
      ragDegraded = true; // RAG 实际生成失败 → 降级
      console.error('[guide] RAG 生成失败，降级到规则生成：', err.message);
    }
    try {
      const guide = buildGuide({
        pages: wiki,
        shops: extra.shops,
        activities: extra.activities,
        feedbackMap: extra.feedbackMap,
        purposeId: input.purposeId,
        interests: Array.isArray(input.interests) ? input.interests : [],
        startDate: input.startDate,
        endDate: input.endDate,
      });
      guide.rag = rag;
      guide.ragDegraded = ragDegraded;
      return sendJSON(res, 200, guide);
    } catch (err) {
      return sendJSON(res, 500, { error: '生成失败：' + err.message });
    }
  }

  if (req.method === 'POST' && url === '/api/reload') {
    wikiCache = null; wikiLoading = null; wikiError = null;
    extraCache = null; extraLoading = null;
    ragIndex = null; ragIndexLoading = null;
    const [wiki, extra] = await Promise.all([getWiki(), getExtra()]);
    // FR-8 事件驱动：若已配置 RAG 密钥，则依据 .env 配置的知识库路径异步重建向量索引。
    let ragRebuild = 'skipped';
    if (hasRagCreds()) {
      ragRebuild = 'started';
      buildRagIndex()
        .then(({ chunks, file }) => console.log(`[reload] RAG 索引已重建：${file}（${chunks} 块）`))
        .catch((e) => console.error('[reload] RAG 索引重建失败：', e.message));
    }
    return sendJSON(res, 200, {
      ok: true,
      wikiSource,
      wikiStatus: wikiError ? 'degraded' : 'ok',
      wikiError: wikiError || null,
      wikiCount: wiki.length,
      shopCount: extra.shops.length,
      activityCount: extra.activities.length,
      ragRebuild,
    });
  }

  // ---------- analytics sink (T-M.2/3: 前端事件统一经此后转，端点服务端可控、避开 CORS) ----------
  if (req.method === 'POST' && url === '/api/analytics') {
    const body = await readBody(req);
    const event = String(body.event || '');
    if (!event) return sendJSON(res, 400, { error: '缺少 event' });
    // 合规（NFR-8）：服务端只透传脱敏字段，不在此补充任何隐私红线数据。
    track(event, body.fields || {});
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- account management ----------
  if (req.method === 'POST' && url === '/api/auth/register') {
    const body = await readBody(req);
    try {
      const user = await register(body);
      const { token } = await login({ username: body.username, password: body.password });
      return sendJSON(res, 201, { user }, { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 7) });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && url === '/api/auth/login') {
    const body = await readBody(req);
    try {
      const { token, user } = await login(body);
      return sendJSON(res, 200, { user }, { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 7) });
    } catch (err) {
      return sendJSON(res, 401, { error: err.message });
    }
  }

  if (req.method === 'POST' && url === '/api/auth/logout') {
    const token = parseCookies(req)[COOKIE];
    logout(token);
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (req.method === 'GET' && url === '/api/auth/me') {
    const user = await currentUser(req);
    return sendJSON(res, 200, { user });
  }

  // ---------- 游客 Wiki: reviews ----------
  // Public: list approved reviews (optionally filtered by target).
  if (req.method === 'GET' && url === '/api/reviews') {
    const items = await listApproved({ targetType: query.targetType, targetId: query.targetId });
    return sendJSON(res, 200, { items });
  }

  // Submit a review. Login required (per PO decision 3216ed6 / REG-14).
  // Logged-in users may still post anonymously via the anonymous flag.
  if (req.method === 'POST' && url === '/api/reviews') {
    const user = await currentUser(req);
    if (!user) return sendJSON(res, 401, { error: '请先登录后再发表评价' });
    const body = await readBody(req);
    try {
      const review = await createReview(body, user);
      return sendJSON(res, 201, {
        review,
        message: '感谢分享！你的评价已提交，将在管理员审核通过后公开展示。',
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // FR-11：切换当前登录用户对某条已通过评价的「有用」投票。
  const helpfulMatch = url.match(/^\/api\/reviews\/([^/]+)\/helpful$/);
  if (req.method === 'POST' && helpfulMatch) {
    const user = await currentUser(req);
    if (!user) return sendJSON(res, 401, { error: '请先登录后再投票' });
    try {
      const result = await toggleHelpful(decodeURIComponent(helpfulMatch[1]), user);
      // T-M.2 前端已上报 review_helpful，这里服务端兜底双写（action 以实际变化为准）。
      track('review_helpful', { review_id: helpfulMatch[1], action: result.voted ? 'add' : 'remove' });
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // FR-12：登录用户举报某条已通过评价（含原因）。
  const reportMatch = url.match(/^\/api\/reviews\/([^/]+)\/report$/);
  if (req.method === 'POST' && reportMatch) {
    const user = await currentUser(req);
    if (!user) return sendJSON(res, 401, { error: '请先登录后再举报' });
    const body = await readBody(req);
    try {
      const result = await createReport({
        reviewId: decodeURIComponent(reportMatch[1]),
        reason: body.reason,
        user,
      });
      // T-M.2 服务端双写 review_report（脱敏：仅原因分类长度，不含举报正文全文）。
      track('review_report', {
        review_id: reportMatch[1],
        reason_length: String(body.reason || '').length,
        reporter_role: user.role === 'admin' ? 'admin' : 'visitor',
      });
      return sendJSON(res, 201, { ...result, message: '举报已提交，管理员将尽快处理。' });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // ---------- my reviews (authenticated users only) ----------
  if (req.method === 'GET' && url === '/api/my-reviews') {
    const u = await currentUser(req);
    if (!u) return sendJSON(res, 401, { error: '请先登录' });
    const list = await readAllReviews();
    const items = list
      .filter((r) => r.authorId === u.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return sendJSON(res, 200, { items });
  }

  // ---------- admin moderation ----------
  if (url.startsWith('/api/admin/')) {
    const user = await currentUser(req);
    if (!user) return sendJSON(res, 401, { error: '请先登录' });
    if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });

    if (req.method === 'GET' && url === '/api/admin/reviews') {
      const [items, stats] = await Promise.all([
        listForAdmin({ status: query.status }),
        counts(),
      ]);
      return sendJSON(res, 200, { items, counts: stats });
    }

    // GET /api/admin/reviews/:id — full record for admin detail view
    const revMatch = url.match(/^\/api\/admin\/reviews\/([^/]+)$/);
    if (req.method === 'GET' && revMatch) {
      const id = decodeURIComponent(revMatch[1]);
      const list = await listForAdmin();
      const r = list.find((x) => x.id === id);
      return sendJSON(res, 200, r ? { review: r } : { error: '评价不存在' });
    }

    const modMatch = url.match(/^\/api\/admin\/reviews\/([^/]+)\/moderate$/);
    if (req.method === 'POST' && modMatch) {
      const body = await readBody(req);
      try {
        const result = await moderate(decodeURIComponent(modMatch[1]), body, user);
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    // FR-13.2：批量通过 / 拒绝评价（单条失败不中断整批）。
    const batchMatch = url.match(/^\/api\/admin\/reviews\/batch$/);
    if (req.method === 'POST' && batchMatch) {
      const body = await readBody(req);
      try {
        const result = await batchModerate(
          Array.isArray(body.ids) ? body.ids : [],
          body.action,
          user
        );
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    // ---------- 举报工单（FR-12 / FR-13.1） ----------
    if (req.method === 'GET' && url === '/api/admin/reports') {
      const [items, stats, allReviews] = await Promise.all([
        listReports({ status: query.status }),
        reportCounts(),
        readAllReviews(),
      ]);
      const byId = new Map(allReviews.map((r) => [r.id, r]));
      const enriched = items.map((it) => {
        const rv = byId.get(it.reviewId);
        return {
          ...it,
          reviewTitle: rv ? rv.title || '(无标题)' : '(评价已删除)',
          reviewStatus: rv ? rv.status : 'gone',
          reviewExcerpt: rv ? rv.body.slice(0, 120) : '',
          reviewFlagged: rv ? !!rv.flagged : false,
        };
      });
      return sendJSON(res, 200, { items: enriched, counts: stats });
    }

    const repDetail = url.match(/^\/api\/admin\/reports\/([^/]+)$/);
    if (req.method === 'GET' && repDetail) {
      const id = decodeURIComponent(repDetail[1]);
      const list = await listReports();
      const r = list.find((x) => x.id === id);
      return sendJSON(res, 200, r ? { report: r } : { error: '举报工单不存在' });
    }

    const repResolve = url.match(/^\/api\/admin\/reports\/([^/]+)\/resolve$/);
    if (req.method === 'POST' && repResolve) {
      const body = await readBody(req);
      try {
        const result = await resolveReport(decodeURIComponent(repResolve[1]), body, user);
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    return sendJSON(res, 404, { error: 'Not found' });
  }

  if (req.method === 'GET') return serveStatic(req, res);

  res.writeHead(405).end('Method Not Allowed');
});

const admin = await ensureAdmin();

server.listen(PORT, () => {
  console.log(`WuDaDao Travel Guide running at http://localhost:${PORT}`);
  console.log(`Wiki source: ${getWikiRoot()}${process.env.WUDADAO_KB_PATH ? '（来自 .env WUDADAO_KB_PATH）' : '（仓库内默认，未配置 WUDADAO_KB_PATH）'}`);
  // FR-8 事件驱动：启动时空索引且已配置 RAG 密钥时，后台补建索引（不阻塞启动）。
  if (hasRagCreds()) {
    stat(RAG_INDEX_FILE)
      .then(() => {})
      .catch(() => {
        console.log('[wiki] 未检测到 RAG 索引，后台开始重建…');
        buildRagIndex()
          .then(({ chunks, file }) => console.log(`[wiki] RAG 索引已重建：${file}（${chunks} 块）`))
          .catch((e) => {
            console.error('[wiki] RAG 索引重建失败：', e.message);
            if (/404/.test(e.message)) {
              console.error('[wiki] 提示：embed 接口返回 404，请检查 .env 的 RAG_BASE_URL 与 RAG_EMBED_PATH 是否指向该服务商真实的 embeddings 路由（含模型名 RAG_EMBED_MODEL）。');
            }
          });
      });
  }
  if (admin.created) {
    console.log(`[账号] 已创建管理员：用户名 "${admin.username}" 密码 "${admin.password}"（可用环境变量 ADMIN_USER / ADMIN_PASS 覆盖）`);
  } else {
    console.log(`[账号] 管理员 "${admin.username}" 已存在`);
  }
});

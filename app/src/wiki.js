import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from './frontmatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Wiki root = repository root / WuDaDao  (app sits in <repo>/app)
export const WIKI_ROOT = join(__dirname, '..', '..', 'WuDaDao');

const SKIP_FILES = new Set(['index.md', 'log.md', 'README.md', 'QWEN.md']);
const CORE_ROADS = ['马场道', '睦南道', '大理道', '常德道', '重庆道', '成都道'];

// Walk the wiki and return a structured index of content pages.
export async function loadWiki(root = WIKI_ROOT) {
  const pages = [];
  await walk(root, root, pages);
  return pages;
}

async function walk(dir, root, pages) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.writing' || e.name === 'node_modules') continue;
      await walk(full, root, pages);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      if (SKIP_FILES.has(e.name)) continue;
      if (e.name.startsWith('_')) continue; // _TEMPLATE.md / _README.md
      try {
        const text = await readFile(full, 'utf8');
        const page = parsePage(text, relative(root, full));
        if (page) pages.push(page);
      } catch {
        /* ignore unreadable files */
      }
    }
  }
}

function parsePage(text, relPath) {
  const { meta, body } = splitFrontmatter(text);
  // Skip near-empty template stubs.
  if (body.trim().length < 30) return null;

  const parts = relPath.replace(/\\/g, '/').split('/');
  const category = parts[0]; // e.g. 20-research
  const subcategory = parts[1] || '';
  const id = relPath.replace(/\\/g, '/').replace(/\.md$/, '');

  const title = (meta.title || extractFirstHeading(body) || id).toString().replace(/^"|"$/g, '');
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : [];
  const related = Array.isArray(meta.related) ? meta.related.map(String) : [];
  const sections = extractSections(body);
  const summary = extractSummary(body, sections);
  const addresses = extractAddresses(body, category, subcategory);
  const eventMonths = extractEventMonths(body, meta.date);
  const sources = extractSources(body);

  return {
    id,
    title,
    category,
    subcategory,
    tags,
    related,
    meta,
    body,
    sections,
    summary,
    addresses,
    eventMonths,
    sources,
    path: relPath,
    isVisitable: addresses.length > 0,
  };
}

function extractFirstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function extractSections(body) {
  const sections = {};
  const lines = body.split('\n');
  let current = null;
  let buf = [];
  const flush = () => {
    if (current) sections[current] = buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      current = m[1].trim();
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function extractSummary(body, sections) {
  // Prefer a dedicated overview/生平/地理 section's first paragraph.
  for (const key of ['概述', '生平概述', '地理概述', '内容概述', '基本信息']) {
    if (sections[key]) {
      const p = sections[key].split('\n').find((l) => l.trim() && !l.startsWith('|') && !l.startsWith('#'));
      if (p) return p.trim();
    }
  }
  const paras = body.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>') && !l.startsWith('-'));
  return paras[0] ? paras[0].trim() : '';
}

// Pull Chinese street addresses (e.g. "南海路2号", "重庆道 55 号") and core road names.
function extractAddresses(body, category, subcategory) {
  if (category === '00-raw' || category === '40-memos' || category === '90-archive') return [];
  const found = new Set();
  const numRe = /[一-龥]{1,8}(?:路|道|街|胡同)[\s]*[0-9零一二三四五六七八九十百千两]+号?/g;
  let m;
  while ((m = numRe.exec(body)) !== null) {
    found.add(m[0].replace(/\s+/g, ''));
  }
  // Add core Five Avenues roads when they appear in narrative/factual context.
  for (const road of CORE_ROADS) {
    if (new RegExp(road).test(body) && (subcategory === 'places' || category === '30-writing')) {
      found.add(road);
    }
  }
  return [...found];
}

// Collect month numbers (1-12) associated with an event page.
function extractEventMonths(body, dateField) {
  const months = new Set();
  if (dateField) {
    const m = String(dateField).match(/(\d{4})(?:-(\d{1,2}))/);
    if (m && m[2]) months.add(parseInt(m[2], 10));
  }
  const re = /(\d{4})年\s*(\d{1,2})月/g;
  let mm;
  while ((mm = re.exec(body)) !== null) months.add(parseInt(mm[2], 10));
  return [...months].filter((x) => x >= 1 && x <= 12);
}

// Extract source links from the "## 来源" section.
function extractSources(body) {
  const sec = body.split(/^##\s+来源\s*$/m)[1];
  if (!sec) return [];
  const links = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(sec)) !== null) links.push({ title: m[1], url: m[2] });
  return links;
}

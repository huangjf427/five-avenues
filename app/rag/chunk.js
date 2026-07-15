// 纯函数、零依赖的语料切片器。
// 输入是 src/wiki.js 已经解析好的结构化 pages，
// 把每个页面正文切成带元数据的重叠语料块，供向量化与检索使用。

const DEFAULTS = { maxChars: 900, overlap: 120 };

// 按空行分段，段过长则按 maxChars 硬切并保留 overlap 重叠，避免单段过长超出嵌入模型限制。
function splitText(text, maxChars, overlap) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks = [];
  let buf = '';

  function flushBuf() {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  }

  for (const p of paras) {
    // 单段过长：先切分为符合 maxChars 的小段
    if (p.length > maxChars) {
      if (buf.trim()) {
        chunks.push(buf.trim());
        buf = '';
      }
      for (let i = 0; i < p.length; i += maxChars - overlap) {
        chunks.push(p.slice(i, i + maxChars));
      }
      continue;
    }

    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + p.length + 1 <= maxChars) {
      buf += '\n' + p;
    } else {
      chunks.push(buf.trim());
      const tail = buf.length > overlap ? buf.slice(buf.length - overlap) : buf;
      buf = tail + '\n' + p;
    }
  }
  flushBuf();
  return chunks;
}

export function chunkPages(pages, opts = {}) {
  const { maxChars, overlap } = { ...DEFAULTS, ...opts };
  const out = [];
  for (const p of pages || []) {
    if (!p || !p.body || p.body.trim().length < 30) continue;
    const head =
      `# ${p.title}\n` +
      `分类：${p.category || ''}/${p.subcategory || ''}\n` +
      `标签：${(p.tags || []).join('、')}\n` +
      `地址：${(p.addresses || []).join('、')}`;
    const pieces = splitText(p.body, maxChars, overlap);
    pieces.forEach((piece, i) => {
      out.push({
        id: `${p.id}#${i}`,
        pageId: p.id,
        title: p.title,
        category: p.category,
        subcategory: p.subcategory,
        tags: p.tags || [],
        addresses: p.addresses || [],
        sources: p.sources || [],
        chunkIndex: i,
        text: `${head}\n\n${piece}`,
      });
    });
  }
  return out;
}

// Minimal, dependency-free YAML frontmatter parser.
// Supports the subset used by the WuDaDao wiki:
//   key: value            (string, possibly double-quoted)
//   key: [a, b, c]        (array of bare words)
//   key: ["a", "b"]       (array of quoted strings)
//   key: [[a], [b]]       (Obsidian-style wikilink arrays -> ['a','b'])

export function parseFrontmatter(raw) {
  const meta = {};
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === '') { meta[key] = ''; continue; }
    if (val.startsWith('[')) {
      meta[key] = parseArray(val);
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      meta[key] = val.slice(1, -1);
    } else {
      meta[key] = val;
    }
  }
  return meta;
}

function parseArray(raw) {
  let inner = raw.trim();
  if (inner.startsWith('[') && inner.endsWith(']')) inner = inner.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // strip one level of surrounding [[ ]] or quotes
      let t = s;
      if (t.startsWith('[[') && t.endsWith(']]')) t = t.slice(2, -2).trim();
      else if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1).trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
      return t;
    });
}

// Split a markdown document into { meta, body }.
export function splitFrontmatter(text) {
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, body: text };
  return { meta: parseFrontmatter(fmMatch[1]), body: fmMatch[2] };
}

// 建库脚本：加载 WuDaDao 知识库 -> 切片 -> 向量化 -> 写出 app/data/rag-index.json
// 用法（需先配好 RAG_API_KEY）：
//   node app/rag/index.js
//   # 或： npm run rag:index
// 该脚本属离线任务，运行时需要密钥与可访问的 WuDaDao 目录；
// 索引文件已加入 .gitignore，不入库。

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWiki } from '../src/wiki.js';
import { chunkPages } from './chunk.js';
import { embedBatch, hasRagCreds } from './embed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'rag-index.json');

async function main() {
  if (!hasRagCreds()) {
    console.error('[rag:index] 未配置 RAG_API_KEY，无法生成向量索引。请在 .env 中设置后重试。');
    process.exit(2);
  }
  console.log('[rag:index] 加载 WuDaDao 知识库…');
  const pages = await loadWiki();
  console.log(`[rag:index] 解析到 ${pages.length} 个页面`);
  const chunks = chunkPages(pages);
  console.log(`[rag:index] 切分为 ${chunks.length} 个语料块，开始向量化（可能较慢）…`);
  const vectors = await embedBatch(chunks.map((c) => c.text));
  chunks.forEach((c, i) => {
    c.vector = vectors[i];
  });
  const index = {
    version: 1,
    model: process.env.RAG_EMBED_MODEL || 'embedding-3',
    builtAt: new Date().toISOString(),
    chunks,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(index), 'utf8');
  console.log(`[rag:index] 已写入 ${OUT}（${chunks.length} 块）`);
}

main().catch((e) => {
  console.error('[rag:index] 失败：', e.message);
  process.exit(1);
});

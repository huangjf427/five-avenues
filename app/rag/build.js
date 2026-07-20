// 可复用的 RAG 索引构建函数：加载 WuDaDao 知识库 -> 切片 -> 向量化 -> 写出 rag-index.json。
// 供离线脚本 `rag/index.js` 与运行时「↻ 同步」(server.js /api/reload) 共用，
// 二者都依据 .env 的 WUDADAO_KB_PATH 读取外部知识库（FR-8）。
//
// 调用方需先确保 hasRagCreds() 为 true；本函数不校验密钥，但会在 KB 不可达时抛错。

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWiki, getWikiRoot } from '../src/wiki.js';
import { chunkPages } from './chunk.js';
import { embedBatch } from './embed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'rag-index.json');

export async function buildRagIndex() {
  // loadWiki 会依据 WUDADAO_KB_PATH 读取外部知识库；不可达时显式抛错。
  const pages = await loadWiki();
  const chunks = chunkPages(pages);
  if (!chunks.length) {
    throw new Error(`知识库无可用内容，未生成索引（来源：${getWikiRoot()}）`);
  }
  const vectors = await embedBatch(chunks.map((c) => c.text));
  chunks.forEach((c, i) => {
    c.vector = vectors[i];
  });
  const index = {
    version: 1,
    model: process.env.RAG_EMBED_MODEL || 'embedding-3',
    builtAt: new Date().toISOString(),
    root: getWikiRoot(),
    chunks,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(index), 'utf8');
  return { file: OUT, chunks: chunks.length };
}

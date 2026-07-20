// 离线建库脚本：依据 .env 的 WUDADAO_KB_PATH 读取 WuDaDao 知识库 -> 向量化 -> 写出 rag-index.json
// 用法（需先配好 RAG_API_KEY）：
//   node app/rag/index.js
//   # 或： npm run rag:index
// 索引文件已加入 .gitignore，不入库。

import { buildRagIndex } from './build.js';
import { hasRagCreds } from './embed.js';

async function main() {
  if (!hasRagCreds()) {
    console.error('[rag:index] 未配置 RAG_API_KEY，无法生成向量索引。请在 .env 中设置后重试。');
    process.exit(2);
  }
  console.log('[rag:index] 加载 WuDaDao 知识库（来源：', process.env.WUDADAO_KB_PATH || '<仓库内默认>', '）…');
  const { file, chunks } = await buildRagIndex();
  console.log(`[rag:index] 已写入 ${file}（${chunks} 块）`);
}

main().catch((e) => {
  console.error('[rag:index] 失败：', e.message);
  process.exit(1);
});

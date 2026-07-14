// 纯 JS 向量检索（余弦相似度），零依赖。
// 不引入任何向量数据库，契合项目 NFR-1 零依赖约定。
// 知识库规模（几百块）下，暴力余弦完全够用。

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a) {
  return Math.sqrt(dot(a, a));
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const denom = norm(a) * norm(b);
  return denom ? dot(a, b) / denom : 0;
}

// 在预建索引上做 top-K 检索。queryVec 由调用方负责生成。
export function retrieve(index, queryVec, { topK = 8, minScore = 0.0 } = {}) {
  const chunks = (index && index.chunks) || [];
  return chunks
    .map((c) => ({ chunk: c, score: cosine(queryVec, c.vector) }))
    .filter((x) => x.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);
}

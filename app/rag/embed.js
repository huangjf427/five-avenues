// 零依赖的 Embedding + 对话补全调用（Node 18 全局 fetch）。
// 默认指向智谱（Zhipu / BigModel）paas v4，且与 OpenAI 兼容；
// 通过环境变量可无缝切到 DeepSeek / OpenAI / 本地 Ollama 等。

const BASE = () => process.env.RAG_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const KEY = () => process.env.RAG_API_KEY || '';
// 向量 / 对话路径可单独配置，适配非标准 OpenAI 兼容网关（默认 /embeddings、/chat/completions）。
const EMBED_PATH = () => process.env.RAG_EMBED_PATH || '/embeddings';
const CHAT_PATH = () => process.env.RAG_CHAT_PATH || '/chat/completions';
const EMBED_MODEL = () => process.env.RAG_EMBED_MODEL || 'embedding-3';
const LLM_MODEL = () => process.env.RAG_LLM_MODEL || 'glm-4-flash';

export function hasRagCreds() {
  return !!KEY();
}

function authHeader() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` };
}

// 单条文本 -> 向量
export async function embedOne(text) {
  const url = `${BASE()}${EMBED_PATH()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ model: EMBED_MODEL(), input: String(text).slice(0, 8000) }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`embed ${res.status} ${url}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.data[0].embedding;
}

// 批量向量化（小并发，避免触发限流）
export async function embedBatch(texts, { concurrency = 3 } = {}) {
  const out = new Array(texts.length);
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      out[idx] = await embedOne(texts[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, texts.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

// 对话补全（OpenAI 兼容）。json=true 时要求模型只回 JSON。
export async function chat(messages, { temperature = 0.5, json = false } = {}) {
  const body = { model: LLM_MODEL(), messages, temperature };
  if (json) body.response_format = { type: 'json_object' };
  const url = `${BASE()}${CHAT_PATH()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`chat ${res.status} ${url}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

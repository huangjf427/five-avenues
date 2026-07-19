# RAG 知识库内部 Wiki
> ⚠️ **已过时（归档）**：本文档属早期「RAG 知识库内部 Wiki（Python）」规划，已被 Node.js 零依赖实现取代。详见 `00-已过时归档说明.md`；权威产品文档为仓库根 `REQUIREMENTS.md` / `DESIGN.md`。

将本地文件夹中的知识库(文档为主)整理为可浏览、可检索的网站内部 Wiki。基于 RAG(检索增强生成)。

## 当前进度

- [x] 文档加载与解析(md / txt 立即可用,docx / pdf 在装库后启用)
- [x] 文本切片(递归段落/句子切片)
- [ ] 向量化与索引(Chroma + 本地嵌入)
- [ ] 检索与 RAG 生成管线
- [ ] Wiki 站点生成(静态可浏览 + 语义检索)
- [ ] 搜索 / 问答交互界面

## 快速开始(前半链路,无需重依赖)

```bash
cd rag-wiki
python3 scripts/demo_index.py
# 指定你自己的知识库:KB_ROOT=/path/to/kb python3 scripts/demo_index.py
```

输出 `output/chunks.json`,包含每篇文档解析后的切片结果。

## 完整运行(需安装依赖)

```bash
pip install -r requirements.txt
# 修改 config.yaml 中的 knowledge_base.root 指向真实目录
python3 scripts/demo_index.py
```

## 目录结构

```
rag-wiki/
├── config.yaml            # 配置(知识库路径、模型、输出)
├── requirements.txt
├── src/
│   ├── loader.py          # 文档加载与解析
│   └── chunker.py         # 文本切片
├── scripts/
│   └── demo_index.py      # 扫描->解析->切片 demo
├── sample_docs/           # 示例知识库
└── output/                # 生成产物(chunks.json / chroma / site)
```

## 配置说明

见 `config.yaml`:可切换嵌入模型(local 离线 / cloud API)、生成模型(cloud / local)、输出目录等。

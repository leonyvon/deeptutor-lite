# deeptutor-lite 开发经验与难点记录

> 从 deeptutor（HKUDS，~1GB，llama-index + FastAPI + Next.js）迁移到 pi agent 的完整记录。
> 覆盖：架构决策、pi 扩展开发、pi-knowledge 集成、mastery 系统设计、agent 交互调试、pi-package 打包。

---

## 1. 架构决策：为什么用 pi 重建

### 难点
deeptutor 功能很全（RAG Q&A、Web 搜索、多轮推理、代码执行、记忆、多知识库、测验、研究、可视化、解题、掌握度路径 11 大功能），但依赖太重：llama-index、FAISS、FastAPI、Next.js 前端，安装 ~1GB，冷启动 5-15s。

### 决策
pi agent 是"最小化 harness"，通过 extensions/skills/prompts 三种机制扩展，恰好能承载 deeptutor 的全部能力模式：

| deeptutor 功能 | pi 实现 |
|---|---|
| RAG Q&A | pi-knowledge 扩展（BM25 + vector 混合检索） |
| Web 搜索 | 自定义扩展（Brave API） |
| 多轮推理 | pi 原生 agentic loop |
| 代码执行 | python_run 工具 |
| 多会话记忆 | pi 原生 session 管理 |
| 掌握度路径 | mastery_* 8 个工具 + 状态机 |

**结论**：先确认宿主平台的扩展机制能覆盖需求，再决定迁移，不要一开始就假设必须全部自己造。

---

## 2. pi 扩展开发要点

### 结构
```
~/.pi/agent/extensions/<name>/
├── index.ts        ← 入口，pi.registerTool() 注册工具
├── src/            ← 模块拆分
├── package.json    ← main 指向 index.ts
└── config.json     ← 本地配置
```

### 关键经验
- **工具参数描述（description）是给 agent 看的，不是给人看的**。TypeBox schema 的每个字段 description 直接影响 agent 是否正确调用。要写"agent 需要知道的行为约定"，例如：
  ```
  question: "The question text. Include code snippets (backticks or fenced blocks) when the topic involves code."
  ```
- **工具返回里要带"下一步指令"**。`instruction` 字段告诉 agent 接下来该调什么工具、传什么参数，能把"多工具工作流"固化下来，减少 agent 的自由发挥。
- **description 长度要克制**。一行讲清关键约定；太长 agent 反而不读。与 skill prompt 的职责划分：**工具自己能表达的信息，不要重复写进 prompt**（会导致两处维护、互相矛盾——我们踩过，见 §5）。

---

## 3. pi-knowledge 集成：两小时踩坑

### 问题链
1. `knowledge_add` 报 `fetch failed` —— pi-knowledge 默认从 HuggingFace 下载 embedding 模型。
2. 尝试 `HF_ENDPOINT=https://hf-mirror.com` 环境变量 —— **无效**，pi-knowledge 不读这个变量。
3. 查源码发现它支持 OpenAI 兼容的 embedding 端点配置。

### 解决
```powershell
# User 级环境变量（持久）
setx PI_KNOWLEDGE_EMBEDDING "openai:nomic-embed-text"
setx PI_KNOWLEDGE_EMBEDDING_BASE_URL "http://127.0.0.1:11434/v1"   # 本地 Ollama
setx OPENAI_API_KEY "OLLAMA"   # 占位即可
```
用本机 Ollama 的 nomic-embed-text（768 维）做 embedding，完全离线。

### 教训
- **网络受限环境下，先查库源码的配置项，别信镜像变量**。`fetch failed` 不一定是网络问题，先看它到底往哪发请求。
- Ollama 的 OpenAI 兼容端点（`/v1/embeddings`）是万能解药：任何"需要 OpenAI embedding"的库都能指向它。

### 附带坑：npm 安装
pi-knowledge 依赖 tree-sitter 全家桶，与现有依赖有 peer 冲突：
```bash
npm install --legacy-peer-deps
```

---

## 4. 网络代理（Brave API）

Windows 下直接请求 Brave API 被墙。方案：`undici` 的 `ProxyAgent` 指向本地代理：

```ts
import { ProxyAgent, fetch } from "undici";
const dispatcher = new ProxyAgent("http://127.0.0.1:7897");
fetch(url, { dispatcher });
```

### 教训
- **代理地址写成配置项**（config.json `search.proxy`），不要硬编码——换代理端口时不用改代码。
- **API key 用环境变量注入**（`${BRAVE_API_KEY}` 占位 + 运行时替换），config 文件可安全入库。

---

## 5. mastery 系统：从移植到重构

### 移植（来自 deeptutor 的 learning/ 模块）
- 评分权重：recency `[0.5, 0.7, 0.85, 0.95, 1.0]`（越近的作答权重越高）
- 置信度上限：`{1: 0.5, 2: 0.8}`（一次答对最多 0.5，两次最多 0.8，防侥幸）
- 掌握阈值 gate：0.9

### 重构一：评分从 Levenshtein → 语义
用户要求去掉字符串相似度，改用 **Ollama embedding 余弦相似度**：
- 选择题：精确匹配
- 简答题：≥0.85 语义相似（复用 Ollama nomic-embed-text）
- 开放题：≥0.6 关键词匹配

### 重构二：8 个工具的分工
```
mastery_generate  生成学习路径
mastery_quiz      出题（TUI 交互答题）
mastery_grade     评分 + 更新掌握度
mastery_update    手动更新
mastery_status    查看路径状态
mastery_assess    费曼式讲解评估（概念/设计类）
mastery_build     生成学习地图
mastery_diagnostic 诊断薄弱环节
```
外加：7 阶段 LearningStage 状态机、SRS 间隔重复（按知识类型不同间隔）、ErrorRecord 错题记录。

### 教训
- **评分逻辑要确定性优先**：先做确定性实现，再用 AI 增强，这样可测试、可回滚。
- 工具粒度：一个工具一个职责，比一个大而全的工具好调试得多。

---

## 6. Agent 交互调试：三个最典型的坑

### 坑 1：`ui.select()` 选项截断
pi 的 `ui.select` 对长选项（多行代码题）显示不全。换成 `ui.custom()` 自定义 overlay 组件，配合 `wrapLines()` 完整展示选项。

### 坑 2：代码块在题目中显示不出来
**症状**：mastery_quiz 出的题目带 `**` markdown 包装，代码块丢失。
**排查**：不是渲染问题，是**构造题目文本时用了 markdown 语法包代码**，TUI 渲染把它吞了。
**修复**：去掉多余包装，直接放代码；并把"题目要含代码片段"写进工具参数 description（§2 的机制），让 agent 出题时自带代码。

### 坑 3：agent 不理解"交互式工具已经答完了"（最坑的一个）
**症状**：TUI 组件已弹出选项、用户选完，工具返回 `userAnswer: "C"`。但 agent 看到返回值后说 "Wait, the system already captured the answer? That's strange."，然后**把题目再复述一遍让用户答**。
**根因**：agent 的思维链里"出题 → 等用户回答"还没走完，工具就返回了答案，它的预期被打破。
**修复**（返回结构 + description 双管齐下）：
```json
{
  "success": true,
  "alreadyAnswered": true,     ← 明确标记：这题已经答过了
  "question": "...",
  "options": {...},
  "userAnswer": "C",
  "nextStep": "mastery_grade(kb_name=..., topic=..., answer=...)",  ← 给出精确下一步调用
  "instruction": "This question was already presented interactively and answered. Call mastery_grade — do NOT present again."
}
```
同时在工具 description 里写明流程："When called with `options` in a TUI session, this tool PRESENTS the question AND captures the answer. If the response includes `userAnswer`, do NOT present it again."

### 教训总结
1. **交互式工具的返回信息必须打破 agent 的默认预期**：它默认"工具只是出题"，你要用 `alreadyAnswered` 这类信号明确告诉它"流程已推进到哪一步"。
2. **`nextStep` 给出可直接调用的参数**，比一句自然语言指令可靠得多。
3. **description 与返回结构互相印证**：单靠返回字段，agent 可能不看；单靠 description，运行时信息不足。两个都要。

---

## 7. pi-package 打包：把扩展变成可分发项目

### 规范（对照 pi-ask-user、pi-knowledge 现成包）
```json
{
  "name": "deeptutor-lite",
  "keywords": ["pi-package"],          ← 必须
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  },
  "dependencies": { "undici": "^6.0.0" },   ← 运行时依赖，pi 安装时自动 npm install
  "peerDependencies": {                      ← pi 自带的核心包，别重复安装
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### 本地开发：junction 代替复制
```powershell
# install.ps1 核心逻辑：把仓库目录 junction 到 ~/.pi/agent 对应位置
New-Item -ItemType Junction -Path "$agent\extensions\deeptutor-lite" -Target "$repo\extensions"
```
- **效果**：改代码即改即生效，不用重新安装；pi 重启即加载。
- skills 目录逐个 junction（pi 按子目录发现 skill）；prompts 目录整体 junction。
- **注意**：junction 只能指目录；文件（prompts/*.md）通过"prompts 整体 junction"解决。
- 卸载：删 junction 只删链接，不删目标（`Remove-Item` junction 安全）。

### 配置脱敏
- `config.json`（用户本地，gitignore）
- `config.example.json`（模板，入库）
- API key 全部走环境变量 `${BRAVE_API_KEY}`，config 里只留占位符

### 已验证的安装路径
- 本地：`pi install ./local/path`（开发验证）
- npm/git：`pi install npm:xxx` / `pi install git:github.com/user/repo`
- 临时试装：`pi -e npm:@foo/bar`

---

## 8. 失误记录（引以为戒）

### 误删 chat_history.db
调试过程中 `Remove-Item` 误删了 pi 的会话历史库（30MB），不可恢复。

### 教训
- **破坏性操作前先 `Test-Path` + 列出目标**，确认无误再删。
- 数据库/历史类文件，先备份再动手。
- 长会话中，先明确"我要删的到底是什么"，再执行。

---

## 9. 工作流层面的经验

1. **先写 spec + plan，再动代码**。本次完整走了 brainstorm → spec（设计文档）→ plan（21 任务）→ 实现 → 验证的流程，方向修正成本远低于边写边改。
2. **小步验证**：每个模块（brave_search、kb、mastery）独立注册、独立冒烟测试，再合入。
3. **环境变量改了要开新终端**：Windows 下 setx 后当前会话不生效，容易误判"改了没效果"。
4. **升级 pi 不会动 agent/ 目录**（0.80 → 0.83 实测），但**不要依赖这个**——源码入库（本次就是因此把散文件收编成 git 仓库 + pi-package）。
5. **多业务隔离**：每个业务（deeptutor、未来的金融 agent）一个独立 repo + pi-package，用 `pi install` 安装、`pi config` 按项目启停，避免互相污染上下文。

---

## 10. 速查表（重复踩坑时先看这里）

| 问题 | 答案 |
|---|---|
| embedding 下载失败 | `PI_KNOWLEDGE_EMBEDDING=openai:nomic-embed-text` + BASE_URL 指向 Ollama |
| Brave API 不通 | config 里 proxy 指向 `http://127.0.0.1:7897`（undici ProxyAgent） |
| 题目里代码不显示 | 去 markdown 包装；在 question 参数 description 里要求含代码 |
| agent 重复展示已答题目 | 返回 `alreadyAnswered: true` + `nextStep` + 强 instruction |
| ui.select 截断 | `ui.custom()` + `wrapLines()` |
| 工具描述太长/与 prompt 重复 | 工具能表达的写工具，prompt 只写 workflow |
| 装扩展 peer 冲突 | `npm install --legacy-peer-deps` |
| 改环境变量没生效 | 开新终端 |
| 想隔离多个业务 | 每个业务独立 repo + pi-package，`pi install` 安装 |
| 破坏性删除 | 先 Test-Path + 列出 + 备份 |

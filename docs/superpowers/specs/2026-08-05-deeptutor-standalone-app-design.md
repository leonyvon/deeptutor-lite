# deeptutor 独立应用设计（Standalone App Design）

> 日期：2026-08-05
> 状态：已批准（brainstorming 完成）
> 背景：deeptutor-lite 原为 pi-package（pi coding agent 的扩展包）。用户决定**放弃 pi-package 形态**，就地改造为脱离 coding agent 的独立 CLI 应用，但仍基于 earendil-works 的底层库（pi-agent-core / pi-ai）。

---

## 1. 目标与决策摘要

把 deeptutor-lite 从「pi 扩展包」改造为**独立的终端应用**（bin=`deeptutor`），保留全部 11 个功能模式，不依赖安装 pi coding agent。

| 维度 | 决策 |
|---|---|
| 形态 | 独立 CLI（REPL 交互） |
| 引擎 | `@earendil-works/pi-agent-core`（AgentHarness + Agent + Session） |
| LLM | `@earendil-works/pi-ai`（复用现有 Ollama OpenAI 兼容端点） |
| RAG | vendor pi-knowledge `src/` 为 `src/rag/`（纯逻辑，参数化数据目录） |
| 交互 | `@clack/prompts`（输入/选择）+ chalk 流式输出 |
| 会话 | pi-agent-core 自带 JSONL 会话（`JsonlSessionRepo`），多会话 + 续接 + 分支 |
| 分发 | npm 全局安装，`bin: deeptutor` |
| 仓库 | 就地改造现有 deeptutor-lite 仓库（Git 历史保留），移除 pi-package 痕迹 |
| web_search | 保留 Brave + ProxyAgent 逻辑，配置迁移到应用根 config.json |

## 2. 现状与移植面

### 2.1 现有资产（全部保留，重新组织）

- `extensions/src/`：4 个模块、约 13 个工具（web_search、kb_list/switch/create、python_run、mastery_* 系列 8 个）——工具 execute 逻辑已是纯 Node，仅注册壳依赖 `ExtensionAPI`
- `skills/`：6 个 SKILL.md（deeptutor、mastery、quiz、research、solve、visualize）
- `prompts/`：5 个 workflow prompt
- 环境约定：Brave API key（环境变量注入）、代理 127.0.0.1:7897、Ollama embedding 端点

### 2.2 pi-knowledge 移植面（已侦察确认）

- `src/` 几乎全是纯 Node 逻辑：engine.ts（KnowledgeEngine 类）、storage/sqlite.ts（better-sqlite3 + FTS5 BM25）、embedding/（OpenAI 兼容 API + 本地 worker）、indexer/（chunker + tree-sitter AST）、search/（bm25/vector/fusion/ranking）
- **仅 index.ts + extension.js 耦合 pi**（`export default function(pi: ExtensionAPI)` + registerTool），约 50 行薄壳
- 依赖：better-sqlite3、@huggingface/transformers（本地 embedding worker，可选）、tree-sitter、mammoth、unpdf、ignore
- embedding：`PI_KNOWLEDGE_EMBEDDING=openai:nomic-embed-text` + `PI_KNOWLEDGE_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1`（用户环境现状，必须保留等价配置能力）

## 3. 目标架构

```text
deeptutor-lite/
├── src/
│   ├── index.ts            # bin 入口：解析 args → 启动 REPL
│   ├── config.ts           # config.json + 环境变量加载（路径解析、env 变量引用）
│   ├── cli/
│   │   ├── repl.ts         # 交互主循环（clack 输入框循环）
│   │   ├── commands.ts     # 斜杠命令：/new /list /switch /quit /quiz /research /solve /visualize /mastery /help
│   │   └── ui.ts           # 流式渲染（chalk 增量输出）、工具调用卡片、markdown 摘要渲染
│   ├── agent/
│   │   ├── harness.ts      # AgentHarness 组装（model + session + tools + resources + systemPrompt）
│   │   └── resources.ts    # SKILL.md → Skill[]，prompts → PromptTemplate[]（读取现有 skills/ prompts/ 目录）
│   ├── tools/              # 全部工具纯实现（从 extensions/src 迁移，去除 ExtensionAPI 依赖）
│   │   ├── web_search.ts
│   │   ├── kb_manager.ts
│   │   ├── python_runner.ts
│   │   ├── mastery.ts
│   │   └── knowledge.ts    # RAG 工具（knowledge_add/search 等，调 rag/ 适配层）
│   ├── rag/                # vendor pi-knowledge src/（纯逻辑，数据目录参数化）
│   │   ├── engine.ts       # KnowledgeEngine 薄适配（被 tools/knowledge.ts 调用）
│   │   └── ...             # chunker/ storage/ search/ embedding/（上游原样）
│   └── session/
│       └── repo.ts         # JsonlSessionRepo 配置（sessionsRoot 指向数据目录）
├── skills/                 # 6 个 SKILL.md 原样保留（运行时读取）
├── prompts/                # 5 个 workflow 原样保留（运行时读取）
├── config.example.json     # 示例配置
├── package.json            # bin: deeptutor；deps: pi-agent-core/pi-ai/clack/chalk/undici/better-sqlite3/typebox
└── docs/                   # 经验文档保留
```

### 3.1 数据目录（不再依赖 ~/.pi）

| 内容 | 路径 | 可配置 |
|---|---|---|
| 知识库文档 | `~/.deeptutor/kbs/<kb>/` | `config.kb.rootDir` |
| 检索索引（sqlite + 向量） | `~/.deeptutor/knowledge/` | `config.kb.indexDir` |
| 会话 JSONL | `~/.deeptutor/sessions/` | `config.session.dir` |
| 应用配置 | 仓库 `config.json` / `~/.deeptutor/config.json`（后者覆盖前者） | — |

### 3.2 关键组件职责

- **config.ts**：合并默认值 + config.json + 环境变量；保留 `${VAR}` 引用解析；导出类型化 Config
- **agent/harness.ts**：创建 `JsonlSessionRepo` → 打开/新建 Session → `createModels()` + Ollama OpenAI 兼容 provider → 组装 `AgentHarness({ session, models, tools, resources, model })`；暴露 prompt/skill/promptFromTemplate/订阅
- **cli/repl.ts**：clack 循环——普通文本 → `harness.prompt()`；`/cmd` → commands.ts；流式事件经 ui.ts 渲染
- **cli/ui.ts**：`message_update (text_delta)` → `process.stdout.write` 增量打印；工具调用 → 卡片行；结束 → 空行
- **tools/**：与 pi 扩展版逻辑一致，仅把 `registerTool(pi, ...)` 改为导出 `AgentHarnessTool` 定义（name/label/description/parameters/execute 签名已与 ExtensionAPI 对齐，迁移是机械的）
- **rag/**：vendor 自 pi-knowledge v0.5.2（注明上游版本）；删除扩展注册层；数据目录从 `~/.pi/knowledge` 参数化为 `config.kb.indexDir`；embedding 配置项映射到 config（保留 openai 兼容端点能力）

## 4. 数据流

```text
deeptutor 启动
  → config 加载（默认 + config.json + env）
  → 初始化 KnowledgeEngine（sqlite + embedding，目录不存在则创建）
  → JsonlSessionRepo 打开/新建会话
  → 组装 AgentHarness（model + 全部工具 + skills/prompts resources）
  → REPL 循环（clack）

用户输入
  ├─ /new /list /switch /quit      → 会话管理命令
  ├─ /quiz /research /solve /visualize /mastery /help
  │     → harness.skill("deeptutor-quiz") 或 promptFromTemplate(name)
  └─ 普通文本 → harness.prompt(text)
        事件流 → ui.ts 增量渲染（文本流式 / 工具卡片 / 结束）

工具执行：web_search（Brave+proxy）/ kb_* / knowledge_*（RAG）/ python_run（spawn）/ mastery_*
会话持久化：AgentHarness 写 JSONL（与 pi 同机制）
```

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| LLM 端点不可达 | 友好报错 + 提示检查 base URL / Ollama 状态；不崩溃 |
| embedding API 失败 | 降级纯 BM25（FTS5）检索 + 警告；恢复条件：下次调用前探测 |
| python_run 超时 | kill 子进程 + 报错（默认 30s，上限 300s） |
| Ctrl+C | abort() 当前 run；会话已持久化；安全退出 |
| config 缺失 / apiKey 为空 | 对应工具降级不注册 + 启动警告（web_search 无 key 时跳过注册） |
| SQLite/原生依赖加载失败 | 明确报错提示 `npm rebuild` / Node 版本要求 |

## 6. 测试策略

- **单元**（vitest）：config 解析（env 引用、路径展开、默认值）；kb_manager 文件操作（tmp 目录）；mastery 状态机（tmp 目录，含损坏 .mastery.json 容错）
- **集成冒烟**（真实 Ollama，手动/脚本）：knowledge_add → knowledge_search 命中；harness.prompt 一轮工具调用；web_search 走代理返回结果
- **手动验证清单**：多会话新建/切换/续接；quiz 交互式出题（选项不截断）；python_run 执行；Ctrl+C 安全退出

## 7. 迁移步骤（实施计划细化）

1. **重构工具层**：`extensions/src/*` → `src/tools/*`，去掉 ExtensionAPI 类型，导出 AgentHarnessTool；删除 `extensions/`、`install.ps1`、pi manifest 字段
2. **vendor RAG**：拷贝 pi-knowledge src/ → `src/rag/`，参数化数据目录与 embedding 配置；写薄适配层
3. **agent + session 层**：harness.ts / resources.ts / session/repo.ts / config.ts
4. **CLI 层**：ui.ts / commands.ts / repl.ts / index.ts
5. **package.json 重写**：bin、deps（pi-agent-core、pi-ai、@clack/prompts、chalk、undici、better-sqlite3、typebox）、engines node>=22；README 更新（安装/使用/配置）
6. **验证**：单元测试 + 集成冒烟 + 手动清单

## 8. 非目标（YAGNI）

- 不做 Web UI / RPC 接口（v2 再议）
- 不做多 LLM 提供商切换 UI（pi-ai 支持但默认只配 Ollama 端点，config 可扩展）
- 不做 ink 全屏 TUI（clack 优先，体验不足再升级）
- 不迁移旧 `~/.pi/knowledge` 索引数据（新数据目录；旧数据可手动重索引）
- 不发布 pi-package 兼容层

# deeptutor-lite

> 轻量级 AI 文档辅导 CLI —— 本地知识库 RAG 问答、Web 搜索、互动测验与 mastery 学习路径，全终端 TUI 交互，无需重型编码 Agent。

deeptutor-lite 是 [deeptutor](https://github.com/leonyvon/deeptutor) 的轻量替代版（原系统约 1GB）。它以独立 CLI 形式提供文档辅导能力：读取本地文档建立知识库、基于 RAG 回答文档问题、联网搜索补充资料、生成测验并评估掌握程度，全部在终端内完成。

- **独立运行**：不依赖 pi 编码 agent，作为 standalone 应用直接启动
- **沉浸式 TUI**：ink 7 + React 19 构建，支持鼠标划词、IME 拼音输入、粘贴区块等现代终端交互
- **中文优先**：针对 CJK 字符渲染、IME 光标定位、Windows Terminal 深度优化
- **无默认模型**：对话模型须通过 `/model` 从内置 provider 目录自行配置；数据全部存储在 `~/.deeptutor/`

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 对话辅导 | 与 AI 导师多轮对话，流式输出，可随时中断 |
| RAG 知识库问答 | 索引本地文档（代码 / Markdown / PDF / DOCX），基于语义检索回答 |
| 知识库管理 | 创建、切换、列出多个知识库（`/kb` 系列工具） |
| Web 搜索 | Brave 搜索 API 联网检索，补充实时资料 |
| Python 执行 | 内置安全 Python 沙箱执行环境 |
| Mastery 学习路径 | 测验（quiz）、评分（grade）、评估（assess）、路径构建（build）全套掌握度追踪 |
| 互动选择题 | LLM 出的选择题在 TUI 中弹出选择器，字母感知评分 |
| 会话管理 | 多会话创建 / 切换 / 继续，JSONL 持久化，支持断点恢复 |
| 命令面板 | 输入 `/` 弹出斜杠命令补全菜单 |
| 模型切换 | 运行时随时切换模型（`/model`） |
| 历史回退 | `/rewind` 非破坏式回退对话树，回退到用户消息时自动还原到输入框 |
| 数学渲染 | LaTeX 公式（`$$...$$`）零依赖渲染为 Unicode，无需额外依赖 |

---

## 环境要求

- **Node.js ≥ 22**（ESM，`engines.node >= 22`）
- **终端**：推荐 Windows Terminal + PowerShell 7（CJK / IME / 鼠标划词体验最佳）；其他支持 ANSI 的现代终端亦可
- **对话模型**：无默认值，启动后通过 `/model` 从内置 provider 目录选择（anthropic、openai、google、deepseek、openrouter、opencode-go 等 ~38 个），并按需配置 API key（保存在 `~/.deeptutor/auth.json`）
- **嵌入服务**（RAG 必需）：默认本地 Ollama（`nomic-embed-text` @ `http://127.0.0.1:11434/v1`），可通过 `model.embeddingModel` / `model.embeddingBaseUrl` 配置
- **Ollama（可选）**：mastery 语义评分依赖本地 Ollama 嵌入接口（`/api/embed`）

---

## 安装

### 方式一：pi 包安装（推荐）

```bash
pi install git:github.com/leonyvon/deeptutor-lite
```

### 方式二：源码运行

```bash
git clone https://github.com/leonyvon/deeptutor-lite.git
cd deeptutor-lite
npm install --legacy-peer-deps   # tree-sitter 依赖树存在 peer 冲突，必须加此参数
npm run build
node dist/index.js               # 或 npm run dev 直接以 tsx 运行
```

---

## 配置

### 配置文件

配置加载链（后面的文件覆盖前面的值）：

1. 应用根目录 `config.json`（如存在）
2. `~/.deeptutor/config.json`（用户级覆盖，TUI 内 `/model`、`/brave` 的修改会写入此文件）

参考模板见仓库内 [`config.example.json`](config.example.json)，完整结构：

```json
{
  "search": {
    "provider": "brave",
    "apiKey": "${BRAVE_API_KEY}",
    "proxy": "http://127.0.0.1:7897",
    "maxResults": 5
  },
  "kb": {
    "rootDir": "~/.deeptutor/kbs",
    "indexDir": "~/.deeptutor/knowledge",
    "defaultKB": "default"
  },
  "python": {
    "timeout": 30,
    "maxTimeout": 300
  },
  "model": {
    "embeddingModel": "nomic-embed-text",
    "embeddingBaseUrl": "http://127.0.0.1:11434/v1"
  },
  "session": {
    "dir": "~/.deeptutor/sessions"
  }
}
```

支持 `${ENV_VAR}` 环境变量引用与 `~/` 家目录展开。

> **对话模型无默认值**：`model.provider` / `model.model` / `model.apiKey` 不预置，必须通过 `/model` 选择（自动写入 `~/.deeptutor/config.json`），或手动编辑此文件。
> `model.embeddingModel` / `model.embeddingBaseUrl` 是 RAG 嵌入服务的默认配置，可覆盖。

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `BRAVE_API_KEY` | Brave 搜索 API 密钥（Web 搜索功能必需） | — |
| `DEEPTUTOR_HOME` | 覆盖数据目录（默认 `~/.deeptutor`） | — |

### 命令行参数

```
deeptutor [options]

  -s, --session <id>   按 id 恢复或创建会话
  -h, --help           显示帮助
```

---

## 快速开始

```bash
# 1. 启动 deeptutor
deeptutor

# 2. 首次使用先配置对话模型（无默认值）
/model    # 选择 provider → 按需输入 API key → 选择模型

# 3. 直接提问，或先建知识库再问文档内容
/help
```

会话默认懒创建：输入第一条消息时才建立。用 `deeptutor -s my-lesson` 可指定会话 id。

---

## 使用指南

### 斜杠命令

输入 `/` 自动弹出命令补全菜单（↑↓ 选择，Enter 执行）：

| 命令 | 说明 |
|------|------|
| `/model` | 切换模型（打开模型选择器） |
| `/brave` | 配置 Brave 搜索密钥与代理 |
| `/new` | 新建会话 |
| `/list` | 列出历史会话 |
| `/continue` | 继续/切换会话（**自动恢复上次未完成的选择题**） |
| `/quiz` | 生成测验 |
| `/research` | 运行研究 Agent |
| `/solve` | 分步解题 |
| `/visualize` | 创建图表 / 绘图 |
| `/mastery` | 开始 mastery 学习路径 |
| `/rewind` | 回退到之前的对话轮次（回退到用户消息时自动还原输入框） |
| `/help` | 显示帮助 |
| `/quit` | 退出程序（别名 `/exit`） |

### 交互式选择题

- LLM 出题时，题目会在 TUI 中弹出选择器：↑↓ 选择、Enter 确认、ESC 取消
- 支持字母（`A`）、前缀（`A: 文本`）、全文三种作答形态的评分
- 未完成的选择题会在下次继续该会话时自动恢复弹出（工具结果自动回写会话，Agent 无缝继续）

### 鼠标划词复制

- **无修饰键拖拽** = 应用自绘选区，松开鼠标即复制到剪贴板（消息区与输入框全覆盖）

### 数学公式

Markdown 中的 LaTeX 公式零依赖渲染为 Unicode：

- 块级 `$$ s_i = \frac{b_i - a_i}{\max(a_i, b_i)} $$` → 紫色 Unicode 公式
- 行内 `$...$`（内容含 LaTeX 命令才转换，`$5 and $10` 保持字面）
- 流式输出中途未闭合的 `$$` 也会按数学转换，不闪烁

---

## 快捷键

| 按键 | 行为 |
|------|------|
| `Enter` | 提交消息 |
| `Ctrl+Enter` | 换行（多行输入） |
| `↑` / `↓` | 输入框内光标跨行移动（菜单/选择器打开时归菜单导航） |
| `PgUp` / `PgDn` / 滚轮 | 滚动历史消息（AI 思考中、选择题弹出时也可滚动） |
| `Ctrl+C` | 输入非空 → 清空输入框；输入为空 → 退出程序 |
| 双击 `ESC` | 中断 AI 回答（400ms 窗口，仅处理中有效） |
| `ESC` | 取消选择器/菜单 |
| 无修饰键拖拽 | 自绘选区复制 |
| `Shift+拖拽` | 终端原生选区 |

**状态栏第二行**提示：`拖拽选中文本，松开即复制 | 双击ESC中断AI回答 | CTRL+C 清空输入框/退出程序`

---

## 数据与存储

所有数据默认位于 `~/.deeptutor/`（可用 `DEEPTUTOR_HOME` 覆盖）：

```
~/.deeptutor/
├── config.json      # 用户级配置（TUI 内修改写入）
├── sessions/        # 会话记录（JSONL 格式）
├── kbs/             # 知识库目录（每个 KB 一个子目录）
├── knowledge/       # RAG 索引（SQLite + 向量）
└── auth.json        # 认证信息
```

---

## 项目结构

```
deeptutor-lite/
├── src/
│   ├── index.ts              # CLI 入口：终端模式切换（ALT screen）、ink 渲染
│   ├── config.ts             # 配置加载链（默认值 ← config.json ← ~/.deeptutor/config.json）
│   ├── types.ts              # 核心类型定义
│   ├── agent/
│   │   ├── harness.ts        # DeeptutorRuntime（AgentHarness 封装）
│   │   └── resources.ts      # Agent 资源装配
│   ├── session/
│   │   └── repo.ts           # JsonlSessionRepo 会话仓库
│   ├── tools/                # Agent 工具
│   │   ├── web_search.ts     # Brave Web 搜索
│   │   ├── python_runner.ts  # Python 沙箱执行
│   │   ├── mastery.ts        # mastery 全家桶（quiz/grade/assess/build）
│   │   ├── knowledge.ts      # RAG 问答工具
│   │   ├── kb_manager.ts     # 知识库管理工具
│   │   └── ask_user.ts       # 交互式提问工具（ui_ask）
│   ├── rag/                  # RAG 引擎（移植自 pi-knowledge v0.5.2）
│   │   ├── engine.ts         # 索引与检索主引擎
│   │   ├── indexer/          # 索引器（chunker、code-ast 代码结构切块）
│   │   ├── embedding/        # 嵌入（provider 抽象、vectors）
│   │   ├── search/           # 检索（bm25、vector、fusion 混合、reranker、ranking）
│   │   ├── storage/          # SQLite 存储
│   │   ├── watcher/          # 文件监视自动重建索引
│   │   ├── diagnostics/      # 健康检查
│   │   └── model-worker*     # 嵌入模型 worker 进程
│   └── cli/tui/              # ink TUI 界面
│       ├── App.tsx           # 主应用（模式状态机、斜杠命令、滚动、快捷键）
│       ├── TextInput.tsx     # 输入框（parts 段模型、粘贴区块、窗口化滚动）
│       ├── MessageList.tsx   # 消息列表（扁平行缓冲滚动、自绘选区）
│       ├── StatusBar.tsx     # 状态栏
│       ├── CommandMenu.tsx   # 斜杠命令补全面板
│       ├── AskPicker.tsx     # 选择题选择器（布局预算共享纯函数）
│       ├── RewindPicker.tsx  # /rewind 回退选择器
│       ├── ModelPicker.tsx   # 模型选择器
│       ├── SessionPicker.tsx # 会话选择器
│       ├── BraveConfig.tsx   # Brave 配置面板
│       ├── markdown.ts       # Markdown 渲染（marked + CJK 精确切行）
│       ├── math.ts           # LaTeX → Unicode 转换器
│       ├── theme.ts          # 主题 token（opencode 配色）
│       ├── mouse.ts          # SGR 鼠标事件处理
│       ├── esc.ts            # 双击 ESC 检测
│       ├── history.ts        # 会话 → 消息历史转换
│       ├── ask.ts            # 交互式提问机制（pendingAsk）
│       └── resume.ts         # 未完成选择题的会话恢复
├── skills/                   # pi skills（deeptutor、quiz、mastery、research、solve、visualize）
├── prompts/                  # Agent workflow 提示词
├── config.example.json       # 配置模板
└── package.json
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| TUI | [ink 7](https://github.com/vadimdemedes/ink) + React 19 |
| 语言 | TypeScript 5.9 / ESM / Node ≥22 |
| Agent 引擎 | `@earendil-works/pi-agent-core` + `pi-ai`（0.83） |
| RAG | pi-knowledge v0.5.2（schema v4）移植：BM25 + 向量混合检索、RRF 融合、重排序 |
| 代码索引 | tree-sitter（go/java/python/rust/typescript）AST 结构切块 |
| 文档解析 | mammoth（DOCX）、unpdf（PDF）、Markdown |
| 代码高亮 | shiki 4 |
| Markdown | marked 18（CJK 精确换行） |
| 存储 | better-sqlite3、JSONL 会话 |
| 嵌入 | `@huggingface/transformers` + OpenAI 兼容端点（Ollama） |

---

## 开发指南

```bash
npm run dev        # tsx 直接运行（开发热循环）
npm run build      # tsc 编译（必须 0 错误）
npm run test       # vitest 单元测试
```

### 冒烟 / 复现脚本

项目根目录提供可复跑脚本（真实终端交互 bug 的回归护栏）：

- `_smoke_parts.mjs`（22/22）：输入框交互 + 窗口化滚动
- `_smoke_rewind.mjs`（19/19）：/rewind 回退
- `_smoke_select.mjs`（13/13）：鼠标划词
- `_smoke_anchor.mjs`（5/5）：ink 光标后缀 + #982 全屏补偿
- `_smoke_ask.mjs`（51/51）：选择题模块 / 评分 / AskPicker
- `_smoke_math.mjs`（36/36）：LaTeX → Unicode 转换
- `_smoke_resume.mjs`（14/14）：未完成选择题会话恢复
- `_repro_*.mjs`：各类渲染问题的复现脚本（软换行、硬换行、选项溢出、矮终端等）

> 详细的开发经验与踩坑记录见 [AGENTS.md](AGENTS.md)（CJK 渲染、IME、鼠标模式、ink 增量重绘等系统性总结）。

---

## 常见问题（FAQ）

**Q：中文长行溢出/换行错位？**
A：本应用对所有 CJK 内容使用自绘字符级换行（`wrapToLines`），不依赖终端的单词级断行。如仍异常，请确认终端为 Windows Terminal 或兼容 ANSI 的现代终端。

**Q：输入中文时拼音窗口位置不对？**
A：光标定位使用 ink 官方 `useCursor` API 并补偿了 ink #982 全屏 off-by-one。请更新到最新版本；已知 #982 未合入 7.1.1。

**Q：粘贴多行内容行为怪异？**
A：粘贴使用 bracketed paste 协议（ink `usePaste`），多行粘贴自动转换为粘贴区块，回车换行正常。旧版 Windows Terminal（<1.25）粘贴纯图片会表现为空粘贴，属正常兜底。

**Q：鼠标划词没反应？**
A：确认已开启鼠标跟踪（启动时自动设置）。Shift+拖拽永远走终端原生选区（Windows Terminal 硬编码），属预期行为。

**Q：RAG 回答为空或检索不到内容？**
A：检查嵌入服务是否运行（默认 Ollama `http://127.0.0.1:11434/v1`）、`nomic-embed-text` 是否已拉取、`model.embeddingModel` / `model.embeddingBaseUrl` 是否指向正确的嵌入服务；知识库需要先建立并索引文档（KB 管理工具）。

**Q：未配置模型时提示 "No model configured"？**
A：首次使用必须先运行 `/model` 选择 provider 与模型（内置目录含 anthropic、openai、google、deepseek、openrouter、opencode-go 等），配置会保存到 `~/.deeptutor/config.json`。

**Q：选择题被误判为错误？**
A：已支持 expected 为字母/选项文本/自由文本三种形态的评分映射（精确匹配 → 语义相似度 argmax）。仍异常请提供题目与答案复现。

**Q：如何完全重置？**
A：删除 `~/.deeptutor/` 目录即可（注意：会话与知识库一并清除，破坏性操作前请备份）。

---

## 许可证

MIT © leonyvon

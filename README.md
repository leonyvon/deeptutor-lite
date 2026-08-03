# deeptutor-lite

A lightweight document tutoring system built on [pi agent](https://pi.dev), preserving the core design patterns from [deeptutor](https://github.com/HKUDS/DeepTutor) while eliminating heavy dependencies.

## Features (11/11 deeptutor features preserved)

| Feature | Status | Implementation |
|---------|--------|---------------|
| Document RAG Q&A | ✅ | pi-knowledge (BM25 + vector hybrid) |
| Web Search | ✅ | Brave API + proxy (127.0.0.1:7897) |
| Multi-step Reasoning | ✅ | pi native agentic loop |
| Code Execution | ✅ | python_run tool |
| Multi-session Memory | ✅ | pi native session management |
| Multi-KB Management | ✅ | kb_switch / kb_list / kb_create |
| Quiz Generator | ✅ | quiz.md skill |
| Research Agent | ✅ | research.md skill |
| Data Visualization | ✅ | visualize.md + python_run |
| Problem Solver | ✅ | solve.md skill |
| Mastery Learning Path | ✅ | mastery_generate / mastery_update |

## Quick Start

### Prerequisites
- **Node.js >= 20**
- **Python >= 3.10** (for python_run and visualization)
- **git**

### Install

```bash
# 1. Install pi agent
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2. Install pi-knowledge extension
git clone https://github.com/nczz/pi-knowledge.git ~/.pi/agent/extensions/pi-knowledge
cd ~/.pi/agent/extensions/pi-knowledge && npm install --legacy-peer-deps

# 3. Clone this package and link it into pi
git clone <your-repo-url> deeptutor-lite
cd deeptutor-lite
./install.ps1          # junctions extension/skills/prompts into ~/.pi/agent

# 4. Create KB directory
mkdir -p ~/deeptutor-kbs/default

# 5. Set Brave API key (Windows)
set BRAVE_API_KEY=your-brave-api-key

# 6. Ensure proxy is running
# Default: http://127.0.0.1:7897
# Change in deeptutor-lite/extensions/config.json
```

> **Dev loop**: `install.ps1` creates junctions, so edits in the repo take effect immediately — no reinstall needed. Re-run `install.ps1 -Uninstall` to unlink (repo files stay untouched).
>
> **Distribution**: the repo is a standard pi-package (`keywords: ["pi-package"]` + `pi` manifest). Publish to GitHub/npm and install anywhere with `pi install git:...` or `pi install npm:...`.

### First Run

```bash
# Index a document
pi -p "use knowledge_add to index ~/deeptutor-kbs/default/your-doc.md"

# Ask a question
pi "what does the document say about X?"
```

## Available Tools

| Tool | Description |
|------|-------------|
| `web_search` | Brave web search (via proxy) |
| `kb_switch` | Switch active knowledge base |
| `kb_list` | List all knowledge bases |
| `kb_create` | Create new knowledge base |
| `python_run` | Execute Python code |
| `mastery_generate` | Generate learning path |
| `mastery_update` | Update learning progress |

## Skills (trigger with /skillname)

| Skill | Trigger |
|-------|---------|
| quiz | /quiz or "generate a quiz" |
| research | /research or "investigate" |
| visualize | "draw a chart" or "plot" |
| solve | /solve or "prove" |
| mastery | /mastery or "learning path" |

## Performance

| Metric | deeptutor | deeptutor-lite |
|--------|-----------|---------------|
| Install size | ~1GB | ~50MB |
| RAM baseline | 200MB+ | 50-150MB |
| Cold start | 5-15s | < 1s |
| Dependencies | llama-index, FAISS, FastAPI, Next.js | pi agent + pi-knowledge + undici |

## Lessons Learned

开发难点与经验（pi 扩展、pi-knowledge 集成、mastery 设计、agent 交互调试、pi-package 打包）：见 [docs/lessons-learned.md](docs/lessons-learned.md)

## Architecture

```
pi agent (TUI/CLI)
├── pi-knowledge (RAG: ingest, embed, hybrid search)
├── deeptutor-lite extension (7 custom tools)
└── deeptutor skills (6 SKILL.md workflow documents)
```

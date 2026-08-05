# deeptutor

A lightweight document tutoring CLI — RAG Q&A over your knowledge bases, web search, code execution, and a mastery learning path with deterministic grading. Standalone application (no `pi coding agent` required), built on `pi-agent-core` + `pi-ai`.

## Features

| Feature | Implementation |
|---------|----------------|
| Document RAG Q&A | BM25 + vector hybrid search (vendored from pi-knowledge) |
| Web Search | Brave API + optional proxy |
| Multi-step Reasoning | AgentHarness agentic loop (pi-agent-core) |
| Code Execution | `python_run` tool |
| Multi-session Memory | JSONL sessions (same mechanism as pi) |
| Multi-KB Management | kb_switch / kb_list / kb_create |
| Quiz Generator | `/quiz` workflow skill |
| Research Agent | `/research` workflow skill |
| Data Visualization | `/visualize` + python_run |
| Problem Solver | `/solve` workflow skill |
| Mastery Learning Path | mastery_generate / quiz / grade / status (deterministic + semantic grading) |

## Quick Start

### Prerequisites
- **Node.js >= 22**
- **Python >= 3.10** (for python_run and visualization)
- **An OpenAI-compatible LLM endpoint** (e.g. [Ollama](https://ollama.com)) serving:
  - a chat model (e.g. `qwen3:8b`)
  - an embedding model (e.g. `nomic-embed-text`)
- Optional: an **OpenCode Zen Go** API key (`OPENCODE_API_KEY`) for cloud models
  (deepseek-v4-flash, deepseek-v4-pro, glm-5.1, qwen3.6-plus, ...)

### Install

```bash
# From this repo
npm install --legacy-peer-deps
npm run build
npm link          # exposes the `deeptutor` command

# Or global install from npm (when published)
npm install -g --legacy-peer-deps deeptutor
```

### Configure

Copy `config.example.json` to `config.json` (or `~/.deeptutor/config.json` — the home one overrides) and adjust:

```jsonc
{
  "search": { "apiKey": "${BRAVE_API_KEY}", "proxy": "http://127.0.0.1:7897" },
  "model": { "provider": "openai-compat", "baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen3:8b", "embeddingModel": "nomic-embed-text" }
}
```

`model.provider`:
- `"openai-compat"` (default) — any OpenAI-compatible endpoint (Ollama, vLLM, ...)
- `"opencode-go"` — OpenCode Zen Go cloud catalog (auth via `OPENCODE_API_KEY`)

You can also change the model at runtime with `/model` inside the TUI — no config editing needed.

Data lives under `~/.deeptutor/` (override with `DEEPTUTOR_HOME`):
- `kbs/<name>/` — knowledge base documents
- `knowledge/` — RAG index (SQLite + vectors)
- `sessions/` — JSONL session files

### First Run

```bash
mkdir -p ~/.deeptutor/kbs/default
deeptutor
```

A full-screen TUI opens (opencode-style chat interface). Type messages to talk to the tutor, `/help` for commands.

## TUI Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch LLM provider/model at runtime (OpenCode Zen Go catalog + custom OpenAI-compatible endpoint) |
| `/brave` | Configure Brave search in the interface (API key / proxy / max results, persisted to config) |
| `/quiz <topic>` | Generate a quiz from the knowledge base |
| `/research <topic>` | Run the research agent |
| `/solve <problem>` | Solve a problem step by step |
| `/visualize <data>` | Create a chart or plot |
| `/mastery` | Start the mastery learning path |
| `/new` | Start a new session |
| `/list` / `/switch` | List / switch sessions |
| `/help` / `/quit` | Help / exit |

Keys: `↑↓` navigate pickers, `Enter` confirm, `Esc` cancel, `Ctrl+C` exit.

## Tools

web_search, knowledge_add/search/list/remove/update, kb_switch/list/create, python_run, mastery_generate/quiz/grade/update/status/assess/build/diagnostic.

## Architecture

```
deeptutor TUI (ink — opencode-style full-screen chat)
├── DeeptutorRuntime              — live model switching, Brave config, sessions
├── AgentHarness (pi-agent-core)  — agentic loop, sessions, compaction
├── pi-ai                         — OpenAI-compatible + OpenCode Zen Go providers
├── src/tools/                    — 25+ tools (web_search, kb_*, knowledge_*, python_run, mastery_*)
├── src/rag/                      — vendored pi-knowledge engine (BM25 FTS5 + vector)
├── skills/ prompts/              — 6 SKILL.md workflows + 5 prompt templates
└── src/session/                  — JSONL session repository
```

## Performance

| Metric | deeptutor |
|--------|-----------|
| Install size | ~50MB + Python |
| RAM baseline | 50-150MB |
| Cold start | < 1s |
| Dependencies | pi-agent-core, pi-ai, ink, better-sqlite3, undici |

## Development

```bash
npm run dev      # run from source (tsx)
npm run build    # compile to dist/
npm test         # unit tests
```

Lessons learned (pi extension development, RAG integration, agent interaction debugging): see [docs/lessons-learned.md](docs/lessons-learned.md) and [docs/superpowers/specs/2026-08-05-deeptutor-standalone-app-design.md](docs/superpowers/specs/2026-08-05-deeptutor-standalone-app-design.md).

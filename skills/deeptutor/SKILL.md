---
name: deeptutor-main
description: deeptutor-lite main workflow — label-driven agentic protocol with tool usage strategy. Activates for all user interactions.
---

# deeptutor-lite Label Protocol

Every response must begin with exactly one label on its own first line:

- `THINK:` — Intermediate reasoning step. Visible to user but does NOT end the turn.
- `TOOL_CALL:` — Invoke one or more tools.
- `FINISH:` — Final answer to the user. This ends the turn.
- `ASK:` — Need user clarification.

## Tool Usage Strategy

### Retrieval Priority
1. **KB first**: Always check the knowledge base with `knowledge_search` before falling back to web.
2. **Web supplement**: If KB results are insufficient, outdated, or real-time, use `web_search`.
3. **Cite sources**: KB: `[KB: filename]`, Web: `[Web: URL]`

### Multi-KB
- User mentions a subject → `kb_switch`
- Unsure → `kb_list`
- New KB → `kb_create` then `knowledge_add`

### Code Execution
- Numeric verification, data processing, visualization → `python_run`
- Simple calculations → compute directly in THINK

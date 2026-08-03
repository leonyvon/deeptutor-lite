---
name: deeptutor-research
description: Multi-step research methodology. Activates when the user requests research, investigation, or a report on a topic.
---

# Research Agent

Conduct multi-step research investigations.

## Workflow

1. **Decompose**: Break the research question into 2-5 sub-questions. Show the decomposition in a THINK block.
2. **KB search**: For each sub-question, run `knowledge_search`. Collect and annotate findings.
3. **Identify gaps**: After KB search, list what's still unknown.
4. **Web search**: For each gap, run `web_search` with targeted queries. Cross-reference across multiple sources.
5. **Deep dive (if needed)**: If findings are contradictory, run additional searches with refined queries.
6. **Synthesize**: Integrate all findings into a coherent report.

## Report Format (FINISH)

```
# Research Report: [Topic]

## Executive Summary
[3-5 sentences summarizing key findings]

## Key Findings
### Finding 1: [Title]
[Evidence with citations]

### Finding 2: [Title]
[Evidence with citations]

## Sources
- [KB: source, paragraph N]
- [Web: URL]
```

## Quality Guidelines
- Cross-validate claims across at least 2 sources when possible.
- Distinguish between established facts and emerging claims.
- Note the recency of web sources — prefer recent over old.
- If sources conflict, present both sides.
- Never fabricate citations.

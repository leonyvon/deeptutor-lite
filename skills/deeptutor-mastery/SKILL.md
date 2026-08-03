---
name: deeptutor-mastery
description: Learning path generation and progress tracking. Activates when the user asks about learning paths, study plans, or progress tracking.
---

# Mastery Learning Path

Generate and track learning paths based on knowledge base content.

## Generate Learning Path

1. **Scan KB topics**: Use `knowledge_search` with several broad queries to discover topics.
2. **Build topic graph**: In THINK, list discovered topics with prerequisites, difficulty (1-5), and description.
3. **Generate path**: Call `mastery_generate` with the structured path data.
4. **Present**: Show the user the learning path with topic count and recommended order.

## Track Progress

1. **Update status**: Call `mastery_update` when user completes a topic:
   ```
   TOOL_CALL: mastery_update(kb_name="math", topic="Calculus Basics", status="completed")
   ```
2. **Recommend next**: The tool returns `nextTopic`. Tell the user what to study next.

## Topic Statuses
- `not_started` — haven't begun
- `in_progress` — currently studying
- `completed` — finished

## Progress Rules
- Progress is persisted in each KB's `.mastery.json` file.
- A completed topic unlocks all topics that list it as a prerequisite.
- The recommended next topic is the first `not_started` topic whose prerequisites are all `completed`.
- If multiple topics are eligible, recommend the lowest-difficulty one first.

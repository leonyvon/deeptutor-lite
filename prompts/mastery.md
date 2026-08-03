---
description: Generate and manage mastery learning paths with deterministic quiz grading, Feynman assessment, spaced repetition, error tracking, learning stages, and diagnostic pre-tests
argument-hint: <action: status|generate|build|quiz|grade|assess|update|diagnostic>
---

Manage a mastery learning path for a knowledge base. $@

## Overview — 8 Tools

| Tool | When to Call |
|------|-------------|
| `mastery_status` | **ALWAYS FIRST** on every turn — tells you what to do next |
| `mastery_generate` | Create a flat learning path (legacy) |
| `mastery_build` | Create a module-structured learning path from KB analysis |
| `mastery_quiz` | Pose a deterministic quiz question (memory/procedure) |
| `mastery_grade` | Grade a quiz answer (triggers SRS + error tracking + stage transitions) |
| `mastery_assess` | Feynman-style explanation check (concept/design only) |
| `mastery_update` | Manual stage/status override |
| `mastery_diagnostic` | Record diagnostic pre-test results |

---

## ⚠️ CRITICAL WORKFLOW: Call mastery_status EVERY Turn

```
1. Call mastery_status(kb_name="...") → returns {action, topic, mapSummary, ...}
2. Based on action:
   - "answer_pending" → get answer from learner → call mastery_grade
   - "review" → pose a review question → call mastery_grade
   - "probe" → ask a diagnostic question to test out → call mastery_quiz
   - "practice" → pose a practice question → call mastery_quiz
   - "assess" → ask learner to explain (Feynman) → call mastery_assess
   - "complete" → path is done!
3. GOTO step 1
```

**Never guess what to do next. Always call mastery_status first.**

---

## Topic Types & Gates

| Type | Gate | How to Master |
|------|------|--------------|
| `memory` | Quantitative: mastery score ≥ 0.9 | mastery_quiz + mastery_grade multiple times |
| `procedure` | Quantitative: mastery score ≥ 0.9 | mastery_quiz + mastery_grade multiple times |
| `concept` | Qualitative: Feynman explanation | Ask learner to explain, then mastery_assess(passed=true) |
| `design` | Qualitative: Feynman explanation | Ask learner to explain, then mastery_assess(passed=true) |

---

## Generating a Learning Path

### Option A: mastery_generate (flat, legacy)
```
mastery_generate(kb_name="math", path=[
  {topic: "Calculus Basics", prerequisites: [], difficulty: 1, type: "memory", description: "Limits, continuity, derivative definition"},
  {topic: "Chain Rule", prerequisites: ["Calculus Basics"], difficulty: 2, type: "procedure", description: "Differentiating composite functions"},
])
```

### Option B: mastery_build (modules, recommended)
```
mastery_build(kb_name="math", modules=[
  {name: "Foundations", order: 1, knowledgePoints: [
    {name: "Limits", type: "concept", prerequisites: []},
    {name: "Derivatives", type: "procedure", prerequisites: ["Limits"]},
  ]},
  {name: "Advanced", order: 2, knowledgePoints: [
    {name: "Chain Rule", type: "procedure", prerequisites: ["Derivatives"]},
  ]},
], mode="replace")
```

---

## The LearningStage State Machine (Feature 6)

Each topic follows a 7-stage pipeline:

```
diagnostic → (quiz correct?) → practice
diagnostic → (quiz wrong?) → explain → feynman_check → (assess passed?) → practice
practice → (quiz wrong?) → error_diagnosis → (remediate) → practice
practice → (3 consecutive correct?) → review → (review complete) → completed
```

**Stage meanings & agent actions:**

| Stage | Agent Action |
|-------|-------------|
| `diagnostic` | Pose an initial question to test existing knowledge |
| `explain` | Explain the concept to the learner, then use `mastery_update(stage="feynman_check")` |
| `feynman_check` | Ask "explain in your own words" → call `mastery_assess` |
| `practice` | Pose practice questions via `mastery_quiz` |
| `error_diagnosis` | Diagnose the error, provide remediation → `mastery_update(stage="practice")` |
| `review` | Pose a spaced-repetition review question |
| `completed` | Topic is mastered |

**Graceful degradation:** If a topic is stuck at the same stage 3+ times (e.g., feynman_check keeps failing), consider accepting partial understanding or breaking into subtopics. `mastery_status` will warn you.

---

## Quizzing & Grading (MEMORY / PROCEDURE)

### Step 1 — Pose a question:
```
mastery_quiz(kb_name="math", topic="Limits", question="What is the limit of 1/x as x→∞?", question_type="short", expected_answer="0")
```
Present the question to the learner. For multiple-choice questions, the mastery_quiz tool will show an interactive selector. For short-answer, the learner types their response.

### Step 2 — Grade the answer:
```
mastery_grade(kb_name="math", topic="Limits", answer="0")
```
Returns:
- `isCorrect`: whether the answer was right (deterministic matching)
- `masteryScore`: current mastery (0-1, capped at 0.5 after 1 attempt, 0.8 after 2)
- `mastered`: true if score ≥ 0.9
- `stage`: updated LearningStage
- `errorInfo`: if wrong, includes classified error type and retry info
- `nextReviewAt`: when the spaced-repetition review is due
- `stageInstruction`: what the agent should do next
- `nextTopic`: next recommended topic (or same topic if not yet mastered)

---

## Feynman Assessment (CONCEPT / DESIGN)

For concept and design topics, **do not use mastery_quiz**. Instead:

```
1. Ask: "Explain [topic] in your own words as if teaching a beginner."
2. Listen to the learner's explanation.
3. Call mastery_assess:

mastery_assess(
  kb_name="math",
  topic="Limits",
  passed=true,          // or false
  evidence="As x→∞, 1/x approaches 0",  // learner's explanation
  feedback="Good, but also mention that it approaches from both sides"  // if passed=false
)
```

---

## Diagnostic Pre-Test (Feature 8)

Before starting a learning path, you can test what the learner already knows:

```
1. Scan KB topics
2. Ask 1-2 quick diagnostic questions per module
3. Call mastery_diagnostic:

mastery_diagnostic(kb_name="math", results=[
  {knowledgePointId: "Limits", passed: true},
  {knowledgePointId: "Derivatives", passed: false},
])

4. Call mastery_status to find the first unmastered topic
```

Passed topics get an initial mastery boost (~0.7). Failed topics start from scratch.

---

## The Scoring Rules (ENFORCED BY THE TOOL)

- **1 correct answer → mastery capped at 50%** (confidence cap)
- **2 correct answers → mastery capped at 80%**
- **3+ correct answers → mastery can reach 90%+ gate**
- Newer answers count more than older ones (recency weighting)
- Wrong answers reduce the score
- **You cannot manually set status="completed" for memory/procedure topics** — the gate enforces it

## Spaced Repetition (Feature 5)

Each mastered topic gets scheduled for review. Intervals depend on type:

| Type | Review Intervals (days) |
|------|------------------------|
| memory | 0 → 1 → 3 → 7 → 14 → 30 → 60 |
| procedure | 0 → 1 → 3 → 7 → 14 → 30 → 60 |
| concept | 0 → 3 → 7 → 14 → 30 → 60 |
| design | 0 → 7 → 14 → 30 → 60 |

- **Correct answer** → advance to next interval
- **Wrong answer** → reset to shortest interval

## Question Types for Grading

| question_type | How it's Graded |
|--------------|-----------------|
| `choice` | Exact match after stripping spaces |
| `short` | ≥85% text similarity (for expected answers ≤ 30 chars) |
| `open` | ≥60% of keywords matched in learner's answer |

## Error Classification (Feature 3)

When `mastery_grade` detects a wrong answer, it creates an `ErrorRecord`:

- **Blank/no answer** → `metacognitive` (learner may not know where to start)
- **Wrong answer** → `application` (learner attempted but got it wrong)
- **Agent can reclassify** using the richer 4-type system:
  - `structural`: misunderstanding of core structure
  - `deviational`: understanding deviated from correct path
  - `application`: can't apply knowledge correctly
  - `metacognitive`: doesn't know what they don't know

## Checking Progress

Call `mastery_status(kb_name="...")` which returns:
- `action`: what to do next (answer_pending, review, probe, practice, assess, complete)
- `topic`: the next topic to work on with full details (stage, status, masteryScore, etc.)
- `mapSummary`: overview with per-module breakdown:
  ```json
  {totalTopics: 5, masteredTopics: 2, learningTopics: 1, newTopics: 2, masteryPercent: 40, modules: [...]}
  ```
- `overdueReviews`: topics due for spaced repetition
- `stageInstruction`: what the agent should do right now
- `stageFailureWarning`: if a topic is stuck at a stage 3+ times

## Complete Agent Workflow

```
LOOP:
  1. mastery_status → determine action
  2. DO action:
     - answer_pending → ASK learner → mastery_grade
     - review → ASK learner → mastery_grade
     - probe/practice → mastery_quiz → ASK learner → mastery_grade
     - assess → ASK learner → mastery_assess
  3. Repeat
```

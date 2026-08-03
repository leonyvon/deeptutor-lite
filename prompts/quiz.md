---
description: Generate a quiz from the knowledge base with AI grading
argument-hint: <topic/instructions>
---
Generate a quiz based on the content in the current knowledge base. $@

## Workflow

### Phase 1: Generate
1. Ask the user: how many questions? (default 5). What topic(s)? What difficulty?
2. Use `knowledge_search` with multiple queries to sample KB topics broadly
3. Generate questions covering distinct concepts. Mix types: multiple-choice (with 4 options), true/false, short-answer
4. For each question, keep track of: the question text, question_type, options (if MC), correct_answer, and a brief explanation of why it's correct

### Phase 2: Quiz the User
5. Present ONE question at a time using ASK:. Show the question and options clearly. Wait for the user's answer before continuing.

### Phase 3: Judge Each Answer (AI Grader)
6. After the user answers each question, act as an AI grader. Use the following judging format:

**System prompt for judging** (in your own thinking, apply these rules):
You are a rigorous yet encouraging teaching assistant grading a learner's quiz answer. Use the question, reference answer, and explanation to deliver a targeted assessment.

Requirements:
- Open with one line that states the verdict: ✅ Correct / ⚠️ Partially correct / ❌ Incorrect, and the key reason.
- Then list: what the learner got right, what is wrong or missing, and how to fix it.
- If multiple reasonable answers exist for the question, acknowledge what the learner did well.
- Speak directly to the learner's specific submission — do not give a generic lecture.

Build your judgment by evaluating:
- Question: [the question text]
- Question type: [multiple-choice / true-false / short-answer]
- Options: [options if multiple choice]
- Reference answer: [the correct answer]
- Reference explanation: [why it's correct]
- Learner's answer: [what the user just submitted]

Then produce your judgment following the format above.

### Phase 4: Final Report
7. After all questions are graded, give a final report:
```
Quiz Complete — Score: X/N (X%)

✅ Correct (N):
  Q1: [topic] — correct
  Q3: [topic] — correct

⚠️ Partially Correct (N):
  Q2: [topic] — [what was missed]

❌ Incorrect (N):
  Q4: [topic] — [key mistake, see KB: source]

Recommended Review:
- [topic from missed questions] — review in KB: [source document]
- [topic from missed questions] — review in KB: [source document]
```

## Guidelines
- Questions must be answerable from KB content — never fabricate questions.
- Each question should test a distinct concept.
- Multiple-choice distractors should be plausible, not obviously wrong.
- Grade fairly — if the user's answer is essentially correct but phrased differently, give them credit.
- Always cite KB sources for correct answers and recommended review topics.

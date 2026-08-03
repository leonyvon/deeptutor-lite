---
name: deeptutor-quiz
description: Generate quizzes from knowledge base content. Activates when the user requests a quiz, test, or practice questions.
---

# Quiz Generator

Generate quizzes from knowledge base content.

## Workflow

1. **Determine scope**: Ask the user how many questions (default 5), what topic(s) to cover, and difficulty level.
2. **Sample KB content**: Use `knowledge_search` with multiple queries to get broad coverage of the target topics.
3. **Generate questions**: Create a mix of question types:
   - Multiple choice (with 4 options)
   - True/false
   - Short answer
4. **Present one at a time**: Use `ASK:` to present each question. Wait for the user's answer before moving to the next.
5. **Grade and explain**: After each answer, tell the user if correct/incorrect. For incorrect answers, give the correct answer with explanation referencing KB sources.
6. **Final report**: After all questions, present:
   ```
   Score: X/N (X%)
   Correct: ...
   Incorrect: [topic] — see [KB: source]
   ```

## Question Quality
- Questions must be answerable from the knowledge base content.
- Avoid trivial recall — prefer understanding and application.
- Each question should test a distinct concept.
- Provide plausible distractors for multiple choice.

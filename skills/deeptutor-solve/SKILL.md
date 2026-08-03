---
name: deeptutor-solve
description: Step-by-step problem solving methodology. Activates when the user asks to solve a problem, prove a theorem, or work through an exercise.
---

# Problem Solver

Solve problems using systematic decomposition and tool-assisted verification.

## Workflow

1. **Understand**: Restate the problem in your own words in a THINK block.
2. **Decompose**: Break into sub-problems or proof steps. Show the plan in THINK.
3. **Gather knowledge**: For each step, check KB for relevant theorems, formulas (`knowledge_search`). If not found, use `web_search`.
4. **Execute steps**: For each step:
   - State the reasoning clearly
   - If numerical: verify with `python_run`
   - If symbolic: use `python_run` with sympy where helpful
5. **Verify**: Double-check the solution by plugging back or testing edge cases.
6. **Present**: FINISH with the complete solution, all steps, and verification.

## Proof Formatting
```
**Theorem**: [statement]
**Proof**:
1. [Step with reasoning]
2. [Step with reasoning]
...
**Verification**: [cross-check]
```

## Quality Guidelines
- Every step must be justified (theorem, definition, or calculation).
- Use `python_run` to verify calculations — never trust mental arithmetic.
- Present the answer, not the struggle — but show your work.

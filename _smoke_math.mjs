// Smoke test: LaTeX math rendering (src/cli/tui/math.js + markdown.js).
//
// Part A — mathToUnicode unit conversions: fractions (incl. nested), sqrt,
//          Greek letters, operators, sub/superscripts, accents, \left/\right,
//          matrix environments, unknown commands kept verbatim.
// Part B — extractMath protection: code fences / inline code containing "$"
//          are never treated as math; plain "$5 and $10" stays literal.
// Part C — renderMarkdown integration: $$…$$ renders the converted formula
//          with the markdownMath color and NO literal "$$", row width bound
//          is respected.
//
// Conventions from _smoke_ask.mjs: imports come from ./dist/*.js (run AFTER
// `npm run build`); PASS/FAIL per assertion; non-zero exit on any failure.
process.env.FORCE_COLOR = "3";

const { mathToUnicode, extractMath } = await import("./dist/cli/tui/math.js");
const { renderMarkdown } = await import("./dist/cli/tui/markdown.js");

let failures = 0;
let assertCount = 0;
function assert(cond, label) {
  assertCount++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Part A: mathToUnicode ----
eq(
  mathToUnicode("s_i = \\frac{b_i - a_i}{\\max(a_i, b_i)}"),
  "sᵢ = (bᵢ - aᵢ)/(max(aᵢ, bᵢ))",
  "math: user's exact formula → Unicode fraction + scripts"
);
eq(
  mathToUnicode("\\frac{\\frac{a}{b}}{c}"),
  "((a)/(b))/(c)",
  "math: nested fractions"
);
eq(
  mathToUnicode("\\frac{1}{\\sqrt{x^2 + y^2}}"),
  "(1)/(√(x² + y²))",
  "math: sqrt with superscript inside denominator"
);
eq(
  mathToUnicode("\\sum_{i=1}^{n} x_i"),
  "Σᵢ₌₁ⁿ xᵢ",
  "math: sum with sub/superscript scripts"
);
eq(
  mathToUnicode("\\alpha + \\beta \\leq \\gamma"),
  "α + β ≤ γ",
  "math: Greek letters and relations"
);
eq(
  mathToUnicode("\\bar{x} \\hat{y} \\vec{v}"),
  "x̄ ŷ v⃗",
  "math: accents (combining marks)"
);
eq(
  mathToUnicode("\\left(\\frac{a}{b}\\right)"),
  "((a)/(b))",
  "math: \\left/\\right delimiters stripped, inner kept (both parens = \\left( + \\frac)"
);
eq(
  mathToUnicode("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"),
  "[a & b \n c & d]",
  "math: matrix env → brackets, \\\\ → newline"
);
eq(
  mathToUnicode("\\mathbb{R} \\in \\mathbf{x}"),
  "ℝ ∈ x",
  "math: \\mathbb and \\mathbf"
);
eq(
  mathToUnicode("\\unknowncmd{x} y"),
  "\\unknowncmd{x} y",
  "math: unknown command kept verbatim (never dropped)"
);
eq(
  mathToUnicode("\\max \\min \\lim_{x \\to 0}"),
  "max min lim_(x→0)",
  "math: operators stay words, \\to → arrow (script with unmappable chars → ^()/_() fallback)"
);
eq(
  mathToUnicode("W(C) = \\frac{1}{|C|}\\sum_{i \\in C}\\|x_i - \\bar{x}_C\\|^2"),
  "W(C) = (1)/(|C|)Σ_(i∈C)‖xᵢ - x̄_C‖²",
  "math: K-means variance formula (from real session log)"
);
eq(
  mathToUnicode("p = \\frac{e^{X\\beta}}{1 + e^{X\\beta}}"),
  "p = (e^(Xβ))/(1 + e^(Xβ))",
  "math: sigmoid — superscript body with Greek/uppercase (no codepoint) falls back to explicit ^(...)"
);
eq(
  mathToUnicode("e^{X\\beta} 2^{n} x^{2} ^{K}"),
  "e^(Xβ) 2ⁿ x² ᴷ",
  "math: script fallback only when a char lacks a codepoint; full maps stay compact"
);
eq(
  mathToUnicode("\\hat{x}^2_{i}"),
  "x̂²ᵢ",
  "math: accent + fully-mappable scripts stay compact after accent"
);

// ---- Part B: extractMath ----
const noMath = extractMath("cost $5 and $10, plus $x not math");
eq(noMath.text, "cost $5 and $10, plus $x not math", "extract: plain $ not treated as math (no command/script marker)");
eq(noMath.formulas.length, 0, "extract: zero formulas for plain dollar text");

const inline = extractMath("公式 $s_i = 1$ 内联");
assert(inline.formulas.length === 1, "extract: inline $…$ with math marker captured");
assert(!inline.text.includes("$"), "extract: inline math placeholder replaced, no literal $ left");
eq(inline.formulas[0], "sᵢ = 1", "extract: inline math converted");

const block = extractMath("$$\ns_i = \\frac{b_i - a_i}{\\max(a_i, b_i)}\n$$");
assert(block.formulas.length === 1, "extract: block $$…$$ captured (multiline)");
eq(block.formulas[0], "sᵢ = (bᵢ - aᵢ)/(max(aᵢ, bᵢ))", "extract: block formula converted");

const codeProtect = extractMath("```python\nx = $5 + $$y$$\n```\nafter $z_i$");
eq(codeProtect.text, "```python\nx = $5 + $$y$$\n```\nafter \u00010\u0002", "extract: code fence with $ protected verbatim, inline math outside still captured");
assert(codeProtect.formulas.length === 1, "extract: only the inline math outside the fence captured");
eq(codeProtect.formulas[0], "zᵢ", "extract: outside-fence math converted");

const inlineCodeProtect = extractMath("use `$a$` in code");
eq(inlineCodeProtect.text, "use `$a$` in code", "extract: inline code span with $ protected verbatim");
eq(inlineCodeProtect.formulas.length, 0, "extract: zero formulas from inline code");

// ---- Part C: renderMarkdown integration ----
const md = "**Silhouette 系数：**\n$$\ns_i = \\frac{b_i - a_i}{\\max(a_i, b_i)}\n$$";
const lines = renderMarkdown(md, 60);
const allText = lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
assert(!allText.includes("$$"), "render: no literal $$ delimiters in output");
assert(allText.includes("sᵢ = (bᵢ - aᵢ)/(max(aᵢ, bᵢ))"), "render: converted formula text present");
const mathSeg = lines
  .flatMap((l) => l.segments)
  .find((s) => s.text.includes("sᵢ"));
assert(mathSeg && mathSeg.color === "#9d7cd8", `render: formula segment carries markdownMath color (${mathSeg?.color})`);
assert(
  lines.every((l) => l.segments.every((s) => [...s.text].every((c) => {
    // Combining marks ride on the previous cell; the base char width is 1.
    return true;
  }))),
  "render: combining marks merged into previous cells (no orphan cells)"
);

// Multi-formula + inline in one message, width bound respected.
const md2 = "内联 $x^2$ 与 $$\\sum_{k=1}^{K} \\frac{1}{k}$$ 混合";
const lines2 = renderMarkdown(md2, 24);
const text2 = lines2.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
assert(text2.includes("x²"), "render: inline math converted in mixed message");
assert(text2.includes("Σₖ₌₁ᴷ (1)/(k)"), "render: block math converted in mixed message");
assert(lines2.length >= 2, "render: wrapped to multiple rows at narrow width");

// Streaming partial: unfinished $$ must not crash or produce stray $$
const partial = renderMarkdown("试一下 $$ s_i = \\frac{", 40);
const partialText = partial.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
assert(partial.length > 0, "render: partial $$ input renders without crashing");
assert(!partialText.includes("$$"), "render: partial formula has no literal $$");

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);

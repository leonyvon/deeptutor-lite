/**
 * Minimal LaTeX → Unicode conversion for TUI math rendering (zero deps).
 *
 * marked does not understand `$$...$$` / `$...$`; the markdown renderer
 * extracts math spans BEFORE lexing and substitutes this converted text so a
 * formula renders as readable Unicode instead of raw LaTeX source.
 *
 * Coverage (deliberately bounded, safe-by-default):
 *  - \frac/\dfrac/\tfrac with NESTED braces, \sqrt, \text/\mathrm/\mathbf,
 *    \mathbb (ℝℂℕℚℤ), accents (\bar \hat \vec \tilde \dot \ddot \overline …),
 *    \left/\right delimiters, \begin{env}...\end{env} stripped to brackets,
 *    `\\` line break → "\n".
 *  - Greek letters, operators (\sum → Σ, \max → max, …), relations/symbols
 *    (≤ ≥ ≠ ∈ ≈ × · ± ∞ ∂ ∇ ∀ ∃ ∪ ∩ …).
 *  - Sub/superscripts via Unicode script maps (`_i` → ᵢ, `^2` → ²) with
 *    graceful fallback to the literal `_x`/`^x` when no codepoint exists.
 *  - Unknown commands are kept VERBATIM (never dropped) so nothing is lost.
 */

// ── Maps ──────────────────────────────────────────────────────────────────

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  varepsilon: "ε", vartheta: "ϑ", varphi: "φ", varsigma: "ς",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

/** Function-like operators: keep the word, drop the backslash. */
const OPERATORS: Record<string, string> = {
  max: "max", min: "min", argmax: "argmax", argmin: "argmin",
  log: "log", ln: "ln", lg: "lg", exp: "exp", det: "det", dim: "dim",
  ker: "ker", rank: "rank", Pr: "Pr", deg: "deg", mod: "mod", sign: "sign",
  gcd: "gcd", lcm: "lcm", erf: "erf", sin: "sin", cos: "cos", tan: "tan",
  cot: "cot", sec: "sec", csc: "csc", arcsin: "arcsin", arccos: "arccos",
  arctan: "arctan", sinh: "sinh", cosh: "cosh", tanh: "tanh",
  lim: "lim", limsup: "lim sup", liminf: "lim inf", sup: "sup", inf: "inf",
  sum: "Σ", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭",
  oint: "∮", bigcup: "⋃", bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀",
  bigoplus: "⊕", bigotimes: "⊗",
};

const SYMBOLS: Record<string, string> = {
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", equiv: "≡",
  approx: "≈", approxeq: "≊", sim: "∼", simeq: "≃", propto: "∝",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", nsubseteq: "⊈", nsupseteq: "⊉",
  cup: "∪", cap: "∩", setminus: "∖", uplus: "⊎",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗",
  star: "⋆", circ: "∘", bullet: "•", dagger: "†", ddagger: "‡",
  oplus: "⊕", otimes: "⊗", ominus: "⊖", oslash: "⊘",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  nexists: "∄", emptyset: "∅", varnothing: "∅", aleph: "ℵ", hbar: "ℏ",
  ell: "ℓ", Re: "ℜ", Im: "ℑ", prime: "′", degree: "°",
  to: "→", rightarrow: "→", gets: "←", leftarrow: "←",
  longrightarrow: "⟶", longleftarrow: "⟵",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  leftrightarrow: "↔", uparrow: "↑", downarrow: "↓",
  updownarrow: "↕", mapsto: "↦", longmapsto: "⟼",
  mid: "|", Vert: "‖", lVert: "‖", rVert: "‖", parallel: "∥",
  perp: "⊥", top: "⊤", bot: "⊥",
  angle: "∠", triangle: "△", square: "□", diamondsuit: "♢",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋",
  lceil: "⌈", rceil: "⌉", lbrace: "{", rbrace: "}",
  dots: "…", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  wedge: "∧", land: "∧", vee: "∨", lor: "∨", neg: "¬", lnot: "¬",
  prec: "≺", succ: "≻", preceq: "⪯", succeq: "⪰", ll: "≪", gg: "≫",
  leqq: "≦", geqq: "≧",
};

const ACCENTS: Record<string, string> = {
  bar: "\u0304", overline: "\u0304", hat: "\u0302", check: "\u030C",
  tilde: "\u0303", acute: "\u0301", grave: "\u0300", dot: "\u0307",
  ddot: "\u0308", vec: "\u20D7",
};

/** Accents that span a whole group: apply to the LAST char, not each one. */
const ACCENT_LAST_ONLY = new Set(["vec", "overrightarrow", "overleftarrow"]);

/** Combining-char range used to merge marks into the previous cell. */
const COMBINING = /[\u0300-\u036f\u20d0-\u20ff]/;

const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
  "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
  n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ",
  x: "ₓ",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  i: "ⁱ", n: "ⁿ",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ",
  t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  // Uppercase modifier letters (K-means' K, etc.)
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ",
  K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ", P: "ᴾ", R: "ᴿ", T: "ᵀ",
  U: "ᵁ", V: "ⱽ", W: "ᵂ",
};

const MATHBB: Record<string, string> = {
  R: "ℝ", C: "ℂ", N: "ℕ", Q: "ℚ", Z: "ℤ", P: "ℙ",
};

/** Single-char escapes after a backslash. */
const ESCAPES: Record<string, string> = {
  "{": "{", "}": "}", "|": "‖", "_": "_", "%": "%", "#": "#",
  "$": "$", "&": "&", "~": "~", "^": "^",
  ",": " ", ";": " ", ":": " ", "!": "", " ": " ",
};

/** \begin{env} / \end{env}: bracket-wrapped for display, else dropped. */
const MATRIX_ENVS = new Set([
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
  "cases", "aligned", "split", "array", "smallmatrix",
]);

const TEXT_STYLE_COMMANDS = new Set([
  "text", "mathrm", "mathbf", "mathit", "textrm", "operatorname",
  "boldsymbol", "pmb", "textbf", "textit", "emph",
]);

// ── Conversion ────────────────────────────────────────────────────────────

/** Read a balanced `{...}` group starting at/after `i`. Recursively converts. */
function readGroup(
  src: string,
  i: number
): { ok: boolean; content: string; next: number } {
  let k = i;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] !== "{") return { ok: false, content: "", next: i };
  let depth = 0;
  for (let p = k; p < src.length; p++) {
    if (src[p] === "{") depth++;
    else if (src[p] === "}") {
      depth--;
      if (depth === 0) {
        return {
          ok: true,
          content: mathToUnicode(src.slice(k + 1, p)),
          next: p + 1,
        };
      }
    }
  }
  return { ok: false, content: "", next: i };
}

function applyAccent(content: string, mark: string, lastOnly: boolean): string {
  if (content.length === 0) return mark;
  if (lastOnly) return content.slice(0, -1) + content[content.length - 1] + mark;
  return [...content].map((c) => c + mark).join("");
}

/** Convert a sub/superscript body: map chars with codepoints, keep the rest.
 *  Whitespace is dropped — LaTeX math mode ignores it inside scripts
 *  (`_{i \in C}` → ᵢ∈C, `^{K}` → ᴷ). */
function convertScript(body: string, sub: boolean): string {
  const map = sub ? SUBSCRIPT : SUPERSCRIPT;
  let out = "";
  for (const ch of body) {
    if (/\s/.test(ch)) continue;
    out += map[ch] ?? ch;
  }
  return out;
}

/** Convert a LaTeX math body to display Unicode. */
export function mathToUnicode(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      // Command name (letters) or single-char escape.
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      if (j > i + 1) {
        const cmd = src.slice(i + 1, j);
        let k = j;
        while (k < src.length && /\s/.test(src[k])) k++;

        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
          const num = readGroup(src, k);
          const den = num.ok ? readGroup(src, num.next) : num;
          if (num.ok && den.ok) {
            out.push(`(${num.content})/(${den.content})`);
            i = den.next;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (cmd === "sqrt") {
          const g = readGroup(src, k);
          if (g.ok) {
            out.push(`√(${g.content})`);
            i = g.next;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (ACCENTS[cmd]) {
          const g = readGroup(src, k);
          if (g.ok) {
            out.push(applyAccent(g.content, ACCENTS[cmd], ACCENT_LAST_ONLY.has(cmd)));
            i = g.next;
          } else if (k < src.length && src[k] !== "\\") {
            out.push(src[k] + ACCENTS[cmd]);
            i = k + 1;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (TEXT_STYLE_COMMANDS.has(cmd)) {
          const g = readGroup(src, k);
          if (g.ok) {
            out.push(g.content);
            i = g.next;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (cmd === "mathbb") {
          const g = readGroup(src, k);
          if (g.ok) {
            out.push([...g.content].map((c) => MATHBB[c] ?? c).join(""));
            i = g.next;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (cmd === "left" || cmd === "right" ||
                   cmd === "big" || cmd === "Big" ||
                   cmd === "bigg" || cmd === "Bigg") {
          const d = src[k] ?? "";
          if (d === ".") {
            i = k + 1; // invisible delimiter
          } else if (/[[\](){}|]/.test(d)) {
            out.push(d === "|" ? "‖" : d);
            i = k + 1;
            // Math-mode spacing: whitespace right after a delimiter is
            // separating space (LaTeX ignores it) — skip for compact output.
            while (i < src.length && /\s/.test(src[i])) i++;
          } else {
            i = k; // nothing meaningful — consume nothing
          }
        } else if (cmd === "begin" || cmd === "end") {
          const g = readGroup(src, k);
          if (g.ok) {
            const env = g.content.trim();
            if (cmd === "end" && MATRIX_ENVS.has(env)) {
              // Close bracket on its own column: drop trailing body spaces.
              while (out.length > 0 && out[out.length - 1] === " ") out.pop();
              out.push("]");
            } else if (cmd === "begin" && MATRIX_ENVS.has(env)) {
              out.push("[");
            }
            i = g.next;
            // Same as delimiters: skip separating whitespace after the tag.
            while (i < src.length && /\s/.test(src[i])) i++;
          } else {
            out.push(`\\${cmd}`);
            i = j;
          }
        } else if (GREEK[cmd]) {
          out.push(GREEK[cmd]);
          i = j;
        } else if (OPERATORS[cmd]) {
          out.push(OPERATORS[cmd]);
          i = j;
        } else if (SYMBOLS[cmd]) {
          out.push(SYMBOLS[cmd]);
          i = j;
        } else {
          // Unknown command: keep verbatim — never drop content.
          out.push(`\\${cmd}`);
          i = j;
        }
        continue;
      }
      // Single-char escape.
      const esc = src[i + 1];
      if (esc === "\\") {
        out.push("\n");
        i += 2;
      } else if (esc !== undefined && ESCAPES[esc] !== undefined) {
        out.push(ESCAPES[esc]);
        i += 2;
      } else {
        out.push(ch);
        i++;
      }
      continue;
    }

    if (ch === "_" || ch === "^") {
      const sub = ch === "_";
      let k = i + 1;
      if (src[k] === "{") {
        const g = readGroup(src, k);
        if (g.ok) {
          out.push(convertScript(g.content, sub));
          i = g.next;
          continue;
        }
      }
      const map = sub ? SUBSCRIPT : SUPERSCRIPT;
      const c = src[k];
      if (c !== undefined && map[c]) {
        out.push(map[c]);
        i = k + 1;
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }
  return out.join("");
}

// ── Markdown extraction ───────────────────────────────────────────────────

/**
 * Replace `$$...$$` (block) and `$...$` (inline, math-ish only) spans in
 * markdown with `\u0001<index>\u0002` placeholders; return the converted
 * formulas. Code fences and inline code spans are protected FIRST so `$`
 * inside code is never treated as math.
 *
 * Inline heuristic: only treat `$…$` as math when the body contains a LaTeX
 * command or sub/superscript marker — plain "$5 and $10" stays literal.
 */
export function extractMath(md: string): {
  text: string;
  formulas: string[];
} {
  const formulas: string[] = [];
  const codeSpans: string[] = [];

  let text = md.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => {
    const idx = codeSpans.length;
    codeSpans.push(m);
    return `\u0000${idx}\u0000`;
  });

  // Closed block math. Body is trimmed: the idiomatic `$$\n...\n$$` layout
  // must not leak blank rows into the formula.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) => {
    const idx = formulas.length;
    formulas.push(mathToUnicode(body.trim()));
    return `\u0001${idx}\u0002`;
  });

  // Unclosed block opener left over (streaming mid-formula): treat the rest
  // as math so a partially streamed `$$...` never flashes literal `$$` — same
  // philosophy as trimPartialClosingFences for code fences.
  text = text.replace(/\$\$([\s\S]*)$/, (_m, body: string) => {
    const idx = formulas.length;
    formulas.push(mathToUnicode(body.trim()));
    return `\u0001${idx}\u0002`;
  });

  text = text.replace(/\$([^$\n]+?)\$/g, (m, body: string) => {
    if (!/\\[a-zA-Z]|[_^{}]/.test(body)) return m; // not math — keep literal
    const idx = formulas.length;
    formulas.push(mathToUnicode(body));
    return `\u0001${idx}\u0002`;
  });

  text = text.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => {
    return codeSpans[Number(idx)] ?? "";
  });

  return { text, formulas };
}

/** True when `ch` is a combining mark that must glue to the previous cell. */
export function isCombiningChar(ch: string): boolean {
  return COMBINING.test(ch);
}

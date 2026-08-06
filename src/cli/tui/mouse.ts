/**
 * SGR (1006) mouse event parsing.
 *
 * Windows Terminal encodes mouse events as `ESC[<Cb;Cx;CyM` (press/drag/wheel)
 * or `ESC[<Cb;Cx;Cym` (release). ink strips the leading ESC before passing
 * unknown sequences to useInput, so we parse strings like `[<0;10;20M`.
 *
 * Cb bit layout (XTerm SGR mouse):
 *   bit0-2  button: 0=left 1=middle 2=right  3=release
 *   bit4    shift, bit5(8)=alt, bit6(16)=ctrl (as modifier bits)
 *   bit5(32) motion (drag)
 *   wheel: 64=up 65=down
 *   hover (35) only arrives in 1003 mode which we do not enable.
 */

export interface SgrMouseEvent {
  kind: "press" | "drag" | "release" | "wheel";
  /** Button code as sent (0/1/2 for press, 0/1/2 for drag, 3 for release). */
  button: number;
  /** 1-based screen column. */
  x: number;
  /** 1-based screen row. */
  y: number;
  /** Wheel direction when kind === "wheel". */
  wheelDir?: 1 | -1;
  /** Modifier bits (4=shift, 8=alt, 16=ctrl) if encoded. */
  mods: number;
}

const sgrMouseRe = /\[<(\d+);(\d+);(\d+)([Mm])/g;

/**
 * Parse all SGR mouse sequences inside an ink useInput string.
 * Returns an empty array when nothing matches.
 */
export function parseSgrMouse(input: string): SgrMouseEvent[] {
  const out: SgrMouseEvent[] = [];
  let m: RegExpExecArray | null;
  sgrMouseRe.lastIndex = 0;
  while ((m = sgrMouseRe.exec(input)) !== null) {
    const b = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const isRelease = m[4] === "m";
    const mods = b & 0x1c; // shift(4) | alt(8) | ctrl(16)
    if (b >= 64) {
      // Wheel: 64 = up, 65 = down (button + modifiers can shift these).
      const base = b & ~0x1c;
      out.push({
        kind: "wheel",
        button: base,
        x,
        y,
        wheelDir: base === 64 ? 1 : base === 65 ? -1 : undefined,
        mods,
      });
    } else if (isRelease || (b & 3) === 3) {
      out.push({ kind: "release", button: 3, x, y, mods });
    } else if (b & 0x20) {
      // Motion with a button pressed (drag).
      out.push({ kind: "drag", button: b & 3, x, y, mods });
    } else {
      out.push({ kind: "press", button: b & 3, x, y, mods });
    }
  }
  return out;
}

import type { NumberFormat } from "./types.js";

/**
 * Renders a magnitude as the digits a DEKS number shows.
 *
 * Deliberately not `Intl.NumberFormat`. Its output depends on the ICU build
 * underneath the host, so a document formatted that way would render `1,234.5`
 * on one machine and `1.234,5` on another while claiming to be the same
 * portable file. Everything this needs is declared in the document, so the same
 * document always produces the same string — in a browser, in Node, in a Tauri
 * host and in an export.
 *
 * It is also what the magnitude tween calls on every frame, which is why it
 * formats an intermediate value with the same `decimals` as the final one: a
 * count that gained and lost precision while running would read as a glitch.
 */
export function formatDeksNumber(value: number, format: NumberFormat): string {
  if (!Number.isFinite(value)) throw new Error("number value must be finite");
  const { decimals, groupSeparator, decimalSeparator, symbol, symbolPosition } = format;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new Error("number decimals must be an integer between 0 and 6");
  }

  // `toFixed` rounds half away from zero on the absolute value, which is the
  // behaviour a reader expects from a figure on a slide. Taking the sign off
  // first keeps -0.4 at one decimal from rendering as "-0.4" and at zero
  // decimals from rendering as "-0".
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole = "0", fraction = ""] = fixed.split(".");

  let grouped = whole;
  if (groupSeparator !== "") {
    grouped = "";
    for (let index = 0; index < whole.length; index += 1) {
      const fromEnd = whole.length - index;
      if (index > 0 && fromEnd % 3 === 0) grouped += groupSeparator;
      grouped += whole[index];
    }
  }

  const digits = fraction === "" ? grouped : `${grouped}${decimalSeparator}${fraction}`;
  const signed = negative && Number.parseFloat(fixed) !== 0 ? `-${digits}` : digits;
  if (symbol === "") return signed;
  return symbolPosition === "before" ? `${symbol}${signed}` : `${signed}${symbol}`;
}

// `metadata.PROXY`: how the history of a young fund is backfilled (used by the Monte Carlo page, see docs/montecarlo.md).
import type { ProxyTerm } from "@/types/workbook";
import { cellText } from "./parse";

/** Yahoo symbols: letters, digits and `. ^ = -`. */
const SYMBOL = /^[A-Za-z0-9.^=-]+$/;
const WEIGHT = /^(\d+\.?\d*|\.\d+)$/;
/** Catches typing 20 for 2; no real fund exposure is anywhere near this. */
export const MAX_PROXY_WEIGHT = 10;

/**
 * A Yahoo symbol or a weighted sum of symbols: `SYMBOL` or `SYMBOL*weight` terms joined by `+`, for example
 * `URTH*2` or `URTH*0.9+IEF*0.6`. A missing weight is 1, the decimal separator is a dot, and a blank cell means
 * no proxy. Throws a message that describes the first problem.
 */
export function parseProxy(value: unknown): ProxyTerm[] {
  const text = cellText(value);
  if (text === "") return [];

  const terms = text.split("+").map((part): ProxyTerm => {
    const [symbol, weight, ...extra] = part.split("*").map((piece) => piece.trim());
    if (!symbol) throw new Error(`"${text}" has an empty term.`);
    if (!SYMBOL.test(symbol)) throw new Error(`"${symbol}" is not a valid symbol.`);
    if (extra.length > 0) throw new Error(`"${part.trim()}" has more than one weight.`);
    if (weight === undefined) return { symbol, weight: 1 };
    if (!WEIGHT.test(weight)) throw new Error(`"${weight}" is not a valid weight; use a positive number with a dot.`);
    const numeric = Number(weight);
    if (numeric <= 0 || numeric > MAX_PROXY_WEIGHT) {
      throw new Error(`The weight of ${symbol} must be above 0 and at most ${MAX_PROXY_WEIGHT}.`);
    }
    return { symbol, weight: numeric };
  });

  if (new Set(terms.map((term) => term.symbol)).size !== terms.length) {
    throw new Error(`"${text}" repeats a symbol.`);
  }
  return terms;
}

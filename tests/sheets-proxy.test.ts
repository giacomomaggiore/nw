import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProxy } from "@/lib/sheets/proxy";

describe("parseProxy", () => {
  it("treats a blank cell as no proxy", () => {
    for (const value of ["", "  ", undefined, null]) assert.deepEqual(parseProxy(value), []);
  });

  it("reads a single symbol with the default weight 1", () => {
    assert.deepEqual(parseProxy("AQMIX"), [{ symbol: "AQMIX", weight: 1 }]);
    assert.deepEqual(parseProxy(" IWDA.AS "), [{ symbol: "IWDA.AS", weight: 1 }]);
  });

  it("reads weights and weighted sums", () => {
    assert.deepEqual(parseProxy("URTH*2"), [{ symbol: "URTH", weight: 2 }]);
    assert.deepEqual(parseProxy("URTH*0.9+IEF*0.6"), [{ symbol: "URTH", weight: 0.9 }, { symbol: "IEF", weight: 0.6 }]);
    assert.deepEqual(parseProxy(" SPY * 0.9 + GLD*0.9 "), [{ symbol: "SPY", weight: 0.9 }, { symbol: "GLD", weight: 0.9 }]);
    assert.deepEqual(parseProxy("VT*.5+BND"), [{ symbol: "VT", weight: 0.5 }, { symbol: "BND", weight: 1 }]);
  });

  it("accepts the characters of Yahoo symbols", () => {
    assert.deepEqual(parseProxy("^GSPC+BRK-B+EURUSD=X").map((term) => term.symbol), ["^GSPC", "BRK-B", "EURUSD=X"]);
  });

  it("explains what is wrong", () => {
    assert.throws(() => parseProxy("URTH*"), /not a valid weight/);
    assert.throws(() => parseProxy("URTH*0,9"), /not a valid weight/);
    assert.throws(() => parseProxy("URTH*-1"), /not a valid weight/);
    assert.throws(() => parseProxy("URTH*0"), /above 0/);
    assert.throws(() => parseProxy("URTH*11"), /at most 10/);
    assert.throws(() => parseProxy("URTH*2*3"), /more than one weight/);
    assert.throws(() => parseProxy("URTH+"), /empty term/);
    assert.throws(() => parseProxy("+URTH"), /empty term/);
    assert.throws(() => parseProxy("UR TH"), /not a valid symbol/);
    assert.throws(() => parseProxy("URTH*1+URTH*1"), /repeats a symbol/);
  });
});

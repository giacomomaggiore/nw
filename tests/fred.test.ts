import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fredFileContents } from "@/lib/market-data/fred";

describe("fredFileContents", () => {
  it("writes the compact local macro-data format", () => {
    const contents = fredFileContents("TB3MS", [{ date: "2026-01-01", value: 3.5 }]);
    assert.match(contents, /^\{"series":"TB3MS","downloadedAt":".*","observations":\[\{"date":"2026-01-01","value":3.5\}\]\}\n$/);
    assert.equal(contents.includes("\n\n"), false);
  });
});

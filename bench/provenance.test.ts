import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requiredProvenance } from "./provenance.ts";

describe("benchmark provenance", () => {
  it("fails closed for missing sentinel values", () => {
    for (const value of [undefined, "", "unknown", "0"]) {
      assert.throws(
        () => requiredProvenance("BENCH_COMMIT", value),
        /BENCH_COMMIT/,
      );
    }
  });

  it("returns non-empty provenance values unchanged", () => {
    assert.equal(requiredProvenance("BENCH_COMMIT", "abc123"), "abc123");
  });
});

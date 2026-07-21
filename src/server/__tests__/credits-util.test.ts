import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creditsForDuration } from "@/server/lib/credits.util";

describe("creditsForDuration", () => {
  const pulse = 60;
  const delta = 2;

  it("returns 0 for non-positive duration", () => {
    assert.equal(creditsForDuration(0, pulse, delta), 0);
    assert.equal(creditsForDuration(-5, pulse, delta), 0);
  });

  it("bills 1 credit within the delta grace window", () => {
    assert.equal(creditsForDuration(1, pulse, delta), 1);
    assert.equal(creditsForDuration(2, pulse, delta), 1);
  });

  it("bills 1 credit for the first pulse after delta", () => {
    // effective = 61 - 2 = 59 → ceil(59/60) = 1
    assert.equal(creditsForDuration(61, pulse, delta), 1);
    // effective = 62 - 2 = 60 → ceil(60/60) = 1
    assert.equal(creditsForDuration(62, pulse, delta), 1);
  });

  it("bills 2 credits once effective duration exceeds one pulse", () => {
    // effective = 63 - 2 = 61 → ceil(61/60) = 2
    assert.equal(creditsForDuration(63, pulse, delta), 2);
    // effective = 122 - 2 = 120 → ceil(120/60) = 2
    assert.equal(creditsForDuration(122, pulse, delta), 2);
  });
});

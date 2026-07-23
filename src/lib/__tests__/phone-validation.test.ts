import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeE164Phone,
  normalizeOutboundPhone,
} from "@/lib/phone-validation";

describe("normalizeOutboundPhone", () => {
  it("accepts E.164 numbers", () => {
    assert.equal(normalizeOutboundPhone("+919899077142"), "+919899077142");
  });

  it("converts stored uploaded-contact digits to E.164", () => {
    assert.equal(normalizeOutboundPhone("919899077142"), "+919899077142");
  });

  it("rejects invalid numbers", () => {
    assert.equal(normalizeOutboundPhone("abc"), null);
    assert.equal(normalizeOutboundPhone(""), null);
  });

  it("keeps normalizeE164Phone strict", () => {
    assert.equal(normalizeE164Phone("919899077142"), null);
  });
});

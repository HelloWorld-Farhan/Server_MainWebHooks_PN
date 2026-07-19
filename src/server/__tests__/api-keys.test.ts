import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateApiKey,
  hashApiKeySecret,
  looksLikeApiKey,
  maskApiKeyPrefix,
  parseApiKey,
  rotateApiKeySecret,
  verifyApiKeySecret,
} from "@/server/lib/api-key-crypto";
import {
  assertBranchesAreSubset,
  assertScopesAreSubset,
  requireAnyScope,
  requireBranchAccess,
  requireScope,
} from "@/server/lib/authorization";
import {
  InvalidApiKeyFormatError,
  MissingBranchAccessError,
  MissingScopeError,
} from "@/server/lib/errors";
import type { TenantContext } from "@/server/types/context";

function ctx(partial: Partial<TenantContext> = {}): TenantContext {
  return {
    authType: "user",
    userId: "user-1",
    clerkUserId: "clerk-1",
    companyId: "company-1",
    membershipId: "member-1",
    role: "ADMIN",
    permissions: ["agents:read", "call_logs:read"],
    branchAccess: { type: "SELECTED", branchIds: ["branch-a", "branch-b"] },
    loaders: {} as TenantContext["loaders"],
    ...partial,
  };
}

describe("api-key-crypto", () => {
  it("generates live and test keys in the expected format", () => {
    const live = generateApiKey("LIVE");
    const test = generateApiKey("TEST");

    assert.match(live.plaintext, /^pnx_sk_live_[a-f0-9]+_[a-f0-9]+$/);
    assert.match(test.plaintext, /^pnx_sk_test_[a-f0-9]+_[a-f0-9]+$/);
    assert.equal(live.environment, "LIVE");
    assert.equal(test.environment, "TEST");
    assert.ok(live.keyId.length > 0);
    assert.ok(live.hashedSecret.length > 0);
    assert.notEqual(live.hashedSecret, live.plaintext);
  });

  it("parses and verifies secrets with timing-safe comparison", () => {
    const generated = generateApiKey("LIVE");
    const parsed = parseApiKey(generated.plaintext);

    assert.equal(parsed.keyId, generated.keyId);
    assert.equal(parsed.environment, "LIVE");
    assert.equal(verifyApiKeySecret(parsed.secret, generated.hashedSecret), true);
    assert.equal(verifyApiKeySecret("wrong-secret", generated.hashedSecret), false);
    assert.equal(
      hashApiKeySecret(parsed.secret),
      generated.hashedSecret,
    );
  });

  it("rejects invalid formats", () => {
    assert.equal(looksLikeApiKey("sk_live_abc"), false);
    assert.throws(() => parseApiKey("not-a-key"), InvalidApiKeyFormatError);
    assert.throws(() => parseApiKey("pnx_sk_live_only"), InvalidApiKeyFormatError);
  });

  it("masks key prefixes", () => {
    const masked = maskApiKeyPrefix("pnx_sk_live_abcd1234");
    assert.ok(masked.startsWith("pnx_sk_live_abcd1234"));
    assert.ok(masked.includes("•"));
    assert.ok(!masked.includes("secret"));
  });

  it("rotates secret while keeping keyId", () => {
    const original = generateApiKey("TEST");
    const rotated = rotateApiKeySecret("TEST", original.keyId);
    const parsed = parseApiKey(rotated.plaintext);

    assert.equal(parsed.keyId, original.keyId);
    assert.notEqual(rotated.hashedSecret, original.hashedSecret);
    assert.equal(
      verifyApiKeySecret(parsed.secret, rotated.hashedSecret),
      true,
    );
  });
});

describe("api-key authorization", () => {
  it("requires scopes", () => {
    const userCtx = ctx();
    assert.doesNotThrow(() => requireScope(userCtx, "agents:read" as never));
    assert.throws(
      () => requireScope(userCtx, "agents:write" as never),
      MissingScopeError,
    );
    assert.doesNotThrow(() =>
      requireAnyScope(userCtx, ["agents:write", "agents:read"] as never),
    );
  });

  it("requires branch access", () => {
    const userCtx = ctx();
    assert.doesNotThrow(() => requireBranchAccess(userCtx, "branch-a"));
    assert.throws(
      () => requireBranchAccess(userCtx, "branch-x"),
      MissingBranchAccessError,
    );
  });

  it("enforces scope subset for API-key principals", () => {
    assert.doesNotThrow(() =>
      assertScopesAreSubset(["agents:read", "leads:read"], ["agents:read"]),
    );
    assert.throws(
      () =>
        assertScopesAreSubset(["agents:read"], ["agents:read", "agents:write"]),
      MissingScopeError,
    );
  });

  it("enforces branch subset for API-key principals", () => {
    const apiCtx = ctx({
      authType: "api_key",
      apiKeyId: "key-1",
      branchAccess: { type: "SELECTED", branchIds: ["branch-a"] },
    });
    assert.doesNotThrow(() => assertBranchesAreSubset(apiCtx, ["branch-a"]));
    assert.throws(
      () => assertBranchesAreSubset(apiCtx, ["branch-a", "branch-b"]),
      MissingBranchAccessError,
    );
  });
});

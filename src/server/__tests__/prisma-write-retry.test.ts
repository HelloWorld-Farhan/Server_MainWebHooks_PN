import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";

import {
  isPrismaWriteConflict,
  withPrismaWriteRetry,
} from "@/server/lib/prisma-write-retry";

function writeConflictError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock.",
    {
      code: "P2034",
      clientVersion: "6.19.3",
    },
  );
}

describe("prisma-write-retry", () => {
  it("identifies Prisma P2034 write conflicts", () => {
    assert.equal(isPrismaWriteConflict(writeConflictError()), true);
    assert.equal(
      isPrismaWriteConflict(
        new Prisma.PrismaClientKnownRequestError("not found", {
          code: "P2025",
          clientVersion: "6.19.3",
        }),
      ),
      false,
    );
    assert.equal(isPrismaWriteConflict(new Error("other")), false);
  });

  it("retries write conflicts and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withPrismaWriteRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw writeConflictError();
        }
        return "ok";
      },
      { maxAttempts: 5, baseDelayMs: 1 },
    );

    assert.equal(result, "ok");
    assert.equal(attempts, 3);
  });

  it("rethrows non-conflict errors immediately", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withPrismaWriteRetry(async () => {
          attempts += 1;
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(attempts, 1);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { CreditsRepository } from "@/server/repositories/credits.repository";
import prisma from "@/server/lib/prisma";

describe("tenant isolation", () => {
  const creditsRepo = new CreditsRepository(prisma);
  const callLogsRepo = new CallLogsRepository(prisma);

  it("scopes credit balance lookups by companyId", async () => {
    const balance = await creditsRepo.getBalance("000000000000000000000000");
    assert.equal(balance, null);
  });

  it("returns empty call logs for unknown company", async () => {
    const logs = await callLogsRepo.findRecent("000000000000000000000000", 10);
    assert.deepEqual(logs, []);
  });

  it("does not return call log from another tenant via findById", async () => {
    const log = await callLogsRepo.findById(
      "000000000000000000000001",
      "000000000000000000000002",
    );
    assert.equal(log, null);
  });
});

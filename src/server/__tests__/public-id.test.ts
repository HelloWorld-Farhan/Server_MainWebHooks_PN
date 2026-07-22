import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  decodeLegacyPublicId,
  decodePublicId,
  formatResourceKey,
  generateCampaignPublicId,
  generateLegacyPublicId,
  generatePublicId,
  getVersion,
  inferResourceTypeFromKey,
  isLegacyObjectId,
  parseCampaignPublicId,
  parseLegacyPublicId,
  parsePublicId,
  UnsupportedPublicIdVersionError,
  validateCampaignPublicId,
  validateLegacyPublicId,
  validatePublicId,
} from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { publicIdResolver } from "@/server/services/public-id-resolver.service";

describe("public-id utility", () => {
  const legacyIdentity = { cli: "PNX", companyCode: "A8F2K9" };

  it("formats resource keys per type", () => {
    assert.equal(formatResourceKey(PublicResourceType.CALL_LOG, 1), "CL00000001");
    assert.equal(
      formatResourceKey(PublicResourceType.PHONE_NUMBER, 1),
      "PH000001",
    );
    assert.equal(formatResourceKey(PublicResourceType.AGENT, 23), "AG000023");
    assert.equal(formatResourceKey(PublicResourceType.CONTACT, 1), "CT000001");
    assert.equal(formatResourceKey(PublicResourceType.CAMPAIGN, 1), "CP000001");
  });

  it("generates and parses campaign reference public IDs", () => {
    const publicId = generateCampaignPublicId({
      cli: "PNX",
      campaignResourceKey: "CP000001",
    });

    assert.equal(publicId, "v1.PNX.CP000001");
    assert.deepEqual(parseCampaignPublicId(publicId), {
      version: "v1",
      cli: "PNX",
      campaignResourceKey: "CP000001",
    });
    assert.equal(validateCampaignPublicId(publicId), true);
    assert.equal(
      validateCampaignPublicId("v1.PNX.A8F2K9.CP000001"),
      false,
    );
    assert.equal(parsePublicId(publicId), null);
  });

  it("generates and parses campaign-scoped v1 public IDs", () => {
    const publicId = generatePublicId({
      cli: "PNX",
      campaignId: "CP000001",
      entityId: "PH000001",
    });

    assert.equal(publicId, "v1.PNX.CP000001.PH000001");
    assert.equal(getVersion(publicId), "v1");
    assert.deepEqual(parsePublicId(publicId), {
      version: "v1",
      cli: "PNX",
      campaignId: "CP000001",
      entityId: "PH000001",
    });
    assert.equal(
      validatePublicId(publicId, PublicResourceType.PHONE_NUMBER),
      true,
    );
    assert.equal(validatePublicId(publicId, PublicResourceType.AGENT), false);
    assert.equal(
      validatePublicId("v1.PNX.CP000001", PublicResourceType.CALL_LOG),
      false,
    );
  });

  it("generates and parses call log campaign-scoped public IDs", () => {
    const publicId = generatePublicId({
      cli: "PNX",
      campaignId: "CP000001",
      entityId: "CL00000001",
    });

    assert.equal(publicId, "v1.PNX.CP000001.CL00000001");
    assert.equal(
      validatePublicId(publicId, PublicResourceType.CALL_LOG),
      true,
    );
  });

  it("generates and parses legacy company-scoped public IDs", () => {
    const publicId = generateLegacyPublicId({
      ...legacyIdentity,
      resourceKey: "AG000023",
    });

    assert.equal(publicId, "v1.PNX.A8F2K9.AG000023");
    assert.deepEqual(parseLegacyPublicId(publicId), {
      version: "v1",
      cli: "PNX",
      companyCode: "A8F2K9",
      resourceKey: "AG000023",
    });
    assert.equal(
      validateLegacyPublicId(publicId, PublicResourceType.AGENT),
      true,
    );
    assert.equal(parsePublicId(publicId), null);
  });

  it("infers resource type from key", () => {
    assert.equal(
      inferResourceTypeFromKey("CL00000001"),
      PublicResourceType.CALL_LOG,
    );
    assert.equal(
      inferResourceTypeFromKey("00000001"),
      PublicResourceType.CALL_LOG,
    );
    assert.equal(
      inferResourceTypeFromKey("AG000023"),
      PublicResourceType.AGENT,
    );
  });

  it("rejects unsupported v2 IDs", () => {
    assert.throws(
      () => decodePublicId("v2.encrypted.payload"),
      UnsupportedPublicIdVersionError,
    );
    assert.throws(
      () => decodeLegacyPublicId("v2.encrypted.payload"),
      /Invalid legacy public ID format/,
    );
  });

  it("detects legacy ObjectIds", () => {
    assert.equal(isLegacyObjectId("507f1f77bcf86cd799439011"), true);
    assert.equal(isLegacyObjectId("v1.PNX.CP000001.PH000001"), false);
  });
});

describe("publicIdResolver campaign resolution", () => {
  let companyId: string;
  let userId: string;
  let campaignResourceKey: string;
  let companyCli: string;
  let companyCode: string;

  before(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    companyCli = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join("");
    companyCode = "A8F2K9";
    campaignResourceKey = `CP${String(Math.floor(Math.random() * 999999) + 1).padStart(6, "0")}`;

    const user = await prisma.user.create({
      data: {
        clerkUserId: `public_id_resolver_${suffix}`,
        email: `public-id-resolver-${suffix}@test.com`,
        firstName: "Public",
        lastName: "Id",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: `Public ID Resolver Test ${suffix}`,
        slug: `public-id-resolver-${suffix}`,
        contractId: `PI${suffix.toUpperCase()}`.slice(0, 10),
        cli: companyCli,
        companyCode,
        ownerUserId: user.clerkUserId,
        campaigns: {
          create: {
            resourceKey: campaignResourceKey,
            name: "Resolver Test Campaign",
          },
        },
      },
    });
    companyId = company.id;
  });

  after(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("resolves new-format campaign public IDs", async () => {
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey,
    });

    const internalId = await publicIdResolver.resolveToInternalId(
      companyId,
      publicId,
      PublicResourceType.CAMPAIGN,
    );

    const mapped = await publicIdResolver.mapInternalIdToPublicId(
      companyId,
      internalId,
      PublicResourceType.CAMPAIGN,
    );
    assert.equal(mapped, publicId);
  });

  it("resolves legacy-format campaign public IDs with deprecation warning", async () => {
    const legacyPublicId = generateLegacyPublicId({
      cli: companyCli,
      companyCode,
      resourceKey: campaignResourceKey,
    });

    const warnCalls: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      const internalId = await publicIdResolver.resolveToInternalId(
        companyId,
        legacyPublicId,
        PublicResourceType.CAMPAIGN,
      );

      const mapped = await publicIdResolver.mapInternalIdToPublicId(
        companyId,
        internalId,
        PublicResourceType.CAMPAIGN,
      );

      assert.equal(
        mapped,
        generateCampaignPublicId({ cli: companyCli, campaignResourceKey }),
      );
      assert.ok(
        warnCalls.some((args) =>
          String(args[0]).includes("[public-id:deprecated]"),
        ),
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

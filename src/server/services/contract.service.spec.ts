type WhereArgs = { where?: Record<string, unknown> } | undefined;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  company: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  companyMember: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  companyContact: {
    upsert: jest.fn(),
  },
  creditBalance: {
    upsert: jest.fn(),
  },
};

const mockClerkClient = {
  users: {
    getUser: jest.fn(),
  },
  organizations: {
    createOrganization: jest.fn(),
  },
};

const mockCacheService = {
  invalidateSettingsPages: jest.fn(),
};

const mockEnsureClerkOrganizationMember = jest.fn();

jest.mock("@/server/lib/prisma", () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock("@/auth/clerk", () => ({
  __esModule: true,
  clerkClient: mockClerkClient,
}));

jest.mock("@/server/cache/cache.service", () => ({
  __esModule: true,
  cacheService: mockCacheService,
}));

jest.mock("@/lib/clerk/organization", () => ({
  __esModule: true,
  ensureClerkOrganizationMember: mockEnsureClerkOrganizationMember,
}));

// Imported after the mocks are registered so the service binds to them.
import { contractService } from "@/server/services/contract.service";

const CLERK_USER_ID = "user_3GjZuC42XyiQRjjmV984MHkt8SY";
const CONTRACT_ID = "ZKAFL6AOQ0";
const COMPANY_ID = "comp_1";
const DB_USER_ID = "u_1";

const CLERK_USER = {
  firstName: "Nirupam",
  lastName: "Sharma",
  imageUrl: "https://example.com/avatar.png",
  emailAddresses: [{ id: "e1", emailAddress: "nirupamsharma73@gmail.com" }],
  primaryEmailAddressId: "e1",
  phoneNumbers: [] as { phoneNumber: string }[],
};

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    contractId: CONTRACT_ID,
    ownerUserId: null,
    clerkOrganizationId: null,
    claimedAt: null,
    name: "Nirupam Testing Company",
    slug: "nirupam-testing-company",
    isDemo: false,
    contact: null,
    ...overrides,
  };
}

/**
 * Route company.findFirst to the right result depending on whether the lookup
 * is by ownerUserId (findCompanyByOwnerUserId) or by contractId (link lookup).
 */
function routeCompanyFindFirst(options: {
  byOwner?: unknown;
  byContract?: unknown;
}) {
  mockPrisma.company.findFirst.mockImplementation((args: WhereArgs) => {
    const where = args?.where ?? {};
    if ("ownerUserId" in where) {
      return Promise.resolve(options.byOwner ?? null);
    }
    if ("contractId" in where) {
      return Promise.resolve(options.byContract ?? null);
    }
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  // Sensible happy-path defaults; individual tests override as needed.
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.upsert.mockResolvedValue({
    id: DB_USER_ID,
    clerkUserId: CLERK_USER_ID,
    email: "nirupamsharma73@gmail.com",
  });
  mockPrisma.companyMember.findFirst.mockResolvedValue(null);
  mockPrisma.companyMember.upsert.mockResolvedValue({});
  mockPrisma.companyContact.upsert.mockResolvedValue({});
  mockPrisma.creditBalance.upsert.mockResolvedValue({});
  mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.company.findUnique.mockResolvedValue(
    makeCompany({ ownerUserId: CLERK_USER_ID, claimedAt: new Date() }),
  );

  mockClerkClient.users.getUser.mockResolvedValue(CLERK_USER);
  mockClerkClient.organizations.createOrganization.mockResolvedValue({
    id: "org_mock",
  });
  mockCacheService.invalidateSettingsPages.mockResolvedValue(undefined);
  mockEnsureClerkOrganizationMember.mockResolvedValue(undefined);

  routeCompanyFindFirst({ byOwner: null, byContract: makeCompany() });
});

describe("ContractService.linkContractId", () => {
  it("links a fresh contract and claims the company before creating the membership", async () => {
    const result = await contractService.linkContractId(
      CLERK_USER_ID,
      CONTRACT_ID,
    );

    expect(result).toEqual({
      linked: true,
      contractId: CONTRACT_ID,
      claimedAt: expect.any(String),
      clerkOrganizationId: "org_mock",
    });

    // Company claimed via compare-and-set on unclaimed ownerUserId.
    expect(mockPrisma.company.updateMany).toHaveBeenCalledTimes(1);
    const claimArgs = mockPrisma.company.updateMany.mock.calls[0][0];
    expect(claimArgs.data.ownerUserId).toBe(CLERK_USER_ID);
    expect(claimArgs.where.OR).toEqual([
      { ownerUserId: null },
      { ownerUserId: { isSet: false } },
    ]);

    // Membership created as OWNER/ACTIVE.
    expect(mockPrisma.companyMember.upsert).toHaveBeenCalledTimes(1);
    const memberArgs = mockPrisma.companyMember.upsert.mock.calls[0][0];
    expect(memberArgs.create.role).toBe("OWNER");
    expect(memberArgs.create.status).toBe("ACTIVE");

    // Contact + credit balance ensured.
    expect(mockPrisma.companyContact.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.creditBalance.upsert).toHaveBeenCalledTimes(1);
    expect(mockCacheService.invalidateSettingsPages).toHaveBeenCalledWith(
      COMPANY_ID,
    );

    // Ordering guarantee: claim ownership BEFORE membership so the user can
    // never appear "unlinked" if a later write fails.
    const claimOrder = mockPrisma.company.updateMany.mock.invocationCallOrder[0];
    const memberOrder =
      mockPrisma.companyMember.upsert.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(memberOrder);
  });

  it("throws CONTRACT_NOT_FOUND without creating a user when the contract does not exist", async () => {
    routeCompanyFindFirst({ byOwner: null, byContract: null });

    await expect(
      contractService.linkContractId(CLERK_USER_ID, CONTRACT_ID),
    ).rejects.toMatchObject({ code: "CONTRACT_NOT_FOUND", statusCode: 404 });

    // No orphaned User and no partial writes.
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.company.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.companyMember.upsert).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the contract is already claimed by another user", async () => {
    routeCompanyFindFirst({
      byOwner: null,
      byContract: makeCompany({ ownerUserId: "user_someone_else" }),
    });

    await expect(
      contractService.linkContractId(CLERK_USER_ID, CONTRACT_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.company.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.companyMember.upsert).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the user already has an active membership", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: DB_USER_ID });
    mockPrisma.companyMember.findFirst.mockResolvedValue({ id: "member_1" });

    await expect(
      contractService.linkContractId(CLERK_USER_ID, CONTRACT_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    // Bailed out before touching the company at all.
    expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.company.updateMany).not.toHaveBeenCalled();
  });

  it("resumes an interrupted link for an existing user with no membership on an unclaimed company", async () => {
    // The exact production-broken state: User row exists, company unclaimed,
    // no membership.
    mockPrisma.user.findUnique.mockResolvedValue({ id: DB_USER_ID });
    mockPrisma.companyMember.findFirst.mockResolvedValue(null);
    routeCompanyFindFirst({ byOwner: null, byContract: makeCompany() });

    const result = await contractService.linkContractId(
      CLERK_USER_ID,
      CONTRACT_ID,
    );

    expect(result.linked).toBe(true);
    expect(mockPrisma.company.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.companyMember.upsert).toHaveBeenCalledTimes(1);
  });

  it("self-heals when the company is already owned by the same user but the membership is missing", async () => {
    // ownerUserId already set to this user (claim previously succeeded) but the
    // membership write never landed. updateMany matches nothing (count 0).
    mockPrisma.user.findUnique.mockResolvedValue({ id: DB_USER_ID });
    routeCompanyFindFirst({
      byOwner: makeCompany({ ownerUserId: CLERK_USER_ID }),
      byContract: makeCompany({ ownerUserId: CLERK_USER_ID }),
    });
    mockPrisma.company.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.company.findUnique.mockResolvedValue(
      makeCompany({ ownerUserId: CLERK_USER_ID, claimedAt: new Date() }),
    );

    const result = await contractService.linkContractId(
      CLERK_USER_ID,
      CONTRACT_ID,
    );

    expect(result.linked).toBe(true);
    // Membership is (re)created idempotently even though the claim was a no-op.
    expect(mockPrisma.companyMember.upsert).toHaveBeenCalledTimes(1);
  });

  it("establishes ownership before a failing membership write, so the user is never left unlinked", async () => {
    mockPrisma.companyMember.upsert.mockRejectedValue(
      new Error("simulated membership write failure"),
    );

    await expect(
      contractService.linkContractId(CLERK_USER_ID, CONTRACT_ID),
    ).rejects.toThrow("simulated membership write failure");

    // The company was already claimed for this user before the failure, so
    // getContractLinkStatus() will still report linked=true (owner match).
    expect(mockPrisma.company.updateMany).toHaveBeenCalledTimes(1);
    const claimArgs = mockPrisma.company.updateMany.mock.calls[0][0];
    expect(claimArgs.data.ownerUserId).toBe(CLERK_USER_ID);
  });

  it("rejects invalid contract id formats with a 400 before any lookup", async () => {
    await expect(
      contractService.linkContractId(CLERK_USER_ID, "bad id!"),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT", statusCode: 400 });

    expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
  });
});

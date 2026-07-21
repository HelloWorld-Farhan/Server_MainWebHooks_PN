import type {
  ApiKeyEnvironment,
  CampaignAccessType,
} from "@prisma/client";

import {
  API_KEY_SCOPE_CATALOG,
  getApiKeyScopeLabels,
  isApiKeyScope,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  assertCampaignsAreSubset,
  assertScopesAreSubset,
  requireScope,
} from "@/server/lib/authorization";
import { recordApiKeyAudit } from "@/server/lib/api-key-audit";
import {
  API_KEY_ROTATION_GRACE_MS,
  generateApiKey,
  maskApiKeyPrefix,
  rotateApiKeySecret,
} from "@/server/lib/api-key-crypto";
import {
  ApiKeyNotFoundError,
  DuplicateApiKeyNameError,
  InvalidCampaignError,
  InvalidScopeError,
  ValidationError,
} from "@/server/lib/errors";
import { buildConnection, encodeIdCursor } from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import {
  ApiKeysRepository,
  type ApiKeyFilter,
  type ApiKeyRecord,
} from "@/server/repositories/api-keys.repository";
import type { TenantContext } from "@/server/types/context";

export type CreateApiKeyInput = {
  name: string;
  description?: string | null;
  environment: ApiKeyEnvironment;
  scopes: string[];
  campaignAccessType?: CampaignAccessType;
  campaignIds?: string[];
  expiresAt?: string | null;
};

export type UpdateApiKeyInput = {
  name?: string;
  description?: string | null;
};

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function mapApiKey(row: ApiKeyRecord) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    keyId: row.keyId,
    maskedSecret: maskApiKeyPrefix(row.keyPrefix),
    keyPrefix: row.keyPrefix,
    environment: row.environment,
    status: row.status,
    scopes: row.scopes,
    campaignAccessType: row.campaignAccessType,
    campaignIds: row.campaignAccess.map((b) => b.campaignId),
    expiresAt: toIso(row.expiresAt),
    lastUsedAt: toIso(row.lastUsedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          email: row.createdBy.email,
          firstName: row.createdBy.firstName,
          lastName: row.createdBy.lastName,
        }
      : null,
  };
}

function withSecret(row: ApiKeyRecord, secret: string) {
  return {
    ...mapApiKey(row),
    secret,
  };
}

export class ApiKeysService {
  private readonly repo = new ApiKeysRepository(prisma);

  private async audit(
    ctx: TenantContext,
    apiKeyId: string,
    action: Parameters<typeof recordApiKeyAudit>[3],
    changes: Record<string, unknown> = {},
  ) {
    await recordApiKeyAudit(
      { create: (data) => this.repo.createAuditLog(data) },
      ctx,
      apiKeyId,
      action,
      changes,
    );
  }

  private validateScopes(scopes: string[]): string[] {
    if (!scopes || scopes.length === 0) {
      throw new ValidationError("At least one scope is required");
    }
    const unique = [...new Set(scopes)];
    for (const scope of unique) {
      if (!isApiKeyScope(scope)) {
        throw new InvalidScopeError(scope);
      }
    }
    return unique;
  }

  private async validateCampaigns(
    companyId: string,
    campaignAccessType: CampaignAccessType,
    campaignIds: string[],
  ): Promise<string[]> {
    if (campaignAccessType === "ALL") {
      return [];
    }
    const unique = [...new Set(campaignIds)];
    if (unique.length === 0) {
      throw new ValidationError(
        "At least one campaign is required when campaign access is SELECTED",
      );
    }
    const found = await this.repo.findCampaignsByIds(companyId, unique);
    if (found.length !== unique.length) {
      throw new InvalidCampaignError(
        "One or more campaigns are invalid or do not belong to this company",
      );
    }
    return unique;
  }

  private enforcePrincipalSubset(
    ctx: TenantContext,
    scopes: string[],
    campaignAccessType: CampaignAccessType,
    campaignIds: string[],
  ) {
    if (ctx.authType !== "api_key") return;
    assertScopesAreSubset(ctx.permissions, scopes);
    if (campaignAccessType === "ALL" && ctx.campaignAccess.type !== "ALL") {
      throw new ValidationError(
        "Cannot grant ALL campaign access beyond the current API key",
      );
    }
    if (campaignAccessType === "SELECTED") {
      assertCampaignsAreSubset(ctx, campaignIds);
    }
  }

  async getConnection(
    ctx: TenantContext,
    args: {
      first?: number | null;
      after?: string | null;
      filter?: ApiKeyFilter | null;
    },
  ) {
    requireScope(ctx, PERMISSIONS.API_KEYS_READ);
    const limit = Math.min(Math.max(args.first ?? 20, 1), 100);
    const [rows, totalCount] = await Promise.all([
      this.repo.findConnection(
        ctx.companyId,
        limit,
        args.after ?? undefined,
        args.filter ?? undefined,
      ),
      this.repo.count(ctx.companyId, args.filter ?? undefined),
    ]);

    const connection = buildConnection(rows, limit, (item) =>
      encodeIdCursor(item.id, item.createdAt),
    );

    return {
      edges: connection.edges.map((edge) => ({
        cursor: edge.cursor,
        node: mapApiKey(edge.node),
      })),
      pageInfo: connection.pageInfo,
      totalCount,
    };
  }

  async getById(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_READ);
    const row = await this.repo.findById(ctx.companyId, id);
    if (!row) return null;
    return mapApiKey(row);
  }

  listAvailableScopes(ctx: TenantContext) {
    requireScope(ctx, PERMISSIONS.API_KEYS_READ);
    const labels = getApiKeyScopeLabels();
    return API_KEY_SCOPE_CATALOG.map((scope) => ({
      scope,
      label: labels[scope] ?? scope,
    }));
  }

  async listAccessibleCampaigns(ctx: TenantContext) {
    requireScope(ctx, PERMISSIONS.API_KEYS_READ);
    const campaignIds =
      ctx.campaignAccess.type === "ALL" ? null : ctx.campaignAccess.campaignIds;
    const rows = await this.repo.findAccessibleCampaigns(
      ctx.companyId,
      campaignIds,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
    }));
  }

  async create(ctx: TenantContext, input: CreateApiKeyInput) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);

    const name = input.name?.trim();
    if (!name) throw new ValidationError("API key name is required");

    const existing = await this.repo.findByName(ctx.companyId, name);
    if (existing) throw new DuplicateApiKeyNameError();

    const scopes = this.validateScopes(input.scopes);
    const campaignAccessType = input.campaignAccessType ?? "SELECTED";
    const campaignIds = await this.validateCampaigns(
      ctx.companyId,
      campaignAccessType,
      input.campaignIds ?? [],
    );
    this.enforcePrincipalSubset(ctx, scopes, campaignAccessType, campaignIds);

    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ValidationError("Invalid expiration date");
      }
      if (expiresAt <= new Date()) {
        throw new ValidationError("Expiration must be in the future");
      }
    }

    const generated = generateApiKey(input.environment);
    const row = await this.repo.create({
      companyId: ctx.companyId,
      name,
      description: input.description?.trim() || null,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      hashedSecret: generated.hashedSecret,
      environment: generated.environment,
      scopes,
      campaignAccessType,
      campaignIds,
      expiresAt,
      createdById: ctx.userId,
    });

    await this.audit(ctx, row.id, "CREATED", {
      name,
      environment: row.environment,
      scopes,
      campaignAccessType,
      campaignIds,
    });

    return withSecret(row, generated.plaintext);
  }

  async update(ctx: TenantContext, id: string, input: UpdateApiKeyInput) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    const data: {
      name?: string;
      description?: string | null;
    } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ValidationError("API key name is required");
      if (name !== existing.name) {
        const dup = await this.repo.findByName(ctx.companyId, name);
        if (dup) throw new DuplicateApiKeyNameError();
      }
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }

    const row = await this.repo.update(ctx.companyId, id, data);
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "UPDATED", data);
    return mapApiKey(row);
  }

  async enable(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const row = await this.repo.update(ctx.companyId, id, { status: "ACTIVE" });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "ENABLED");
    return mapApiKey(row);
  }

  async disable(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const row = await this.repo.update(ctx.companyId, id, {
      status: "INACTIVE",
    });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "DISABLED");
    return mapApiKey(row);
  }

  async delete(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();
    await this.repo.softDelete(ctx.companyId, id);
    await this.audit(ctx, id, "DELETED", { name: existing.name });
    return { success: true, id };
  }

  async regenerate(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    const generated = generateApiKey(existing.environment);
    const row = await this.repo.update(ctx.companyId, id, {
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      hashedSecret: generated.hashedSecret,
      previousHashedSecret: null,
      previousSecretExpiresAt: null,
    });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "REGENERATED");
    return withSecret(row, generated.plaintext);
  }

  async rotateSecret(ctx: TenantContext, id: string) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    const rotated = rotateApiKeySecret(existing.environment, existing.keyId);
    const graceEnds = new Date(Date.now() + API_KEY_ROTATION_GRACE_MS);
    const row = await this.repo.update(ctx.companyId, id, {
      keyPrefix: rotated.keyPrefix,
      hashedSecret: rotated.hashedSecret,
      previousHashedSecret: existing.hashedSecret,
      previousSecretExpiresAt: graceEnds,
    });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "ROTATED", {
      previousSecretExpiresAt: graceEnds.toISOString(),
    });
    return withSecret(row, rotated.plaintext);
  }

  async updateScopes(ctx: TenantContext, id: string, scopes: string[]) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    const validated = this.validateScopes(scopes);
    this.enforcePrincipalSubset(
      ctx,
      validated,
      existing.campaignAccessType,
      existing.campaignAccess.map((b) => b.campaignId),
    );

    const row = await this.repo.update(ctx.companyId, id, {
      scopes: validated,
    });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "SCOPES_UPDATED", { scopes: validated });
    return mapApiKey(row);
  }

  async updateCampaignAccess(
    ctx: TenantContext,
    id: string,
    input: { campaignAccessType: CampaignAccessType; campaignIds?: string[] },
  ) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    const campaignIds = await this.validateCampaigns(
      ctx.companyId,
      input.campaignAccessType,
      input.campaignIds ?? [],
    );
    this.enforcePrincipalSubset(
      ctx,
      existing.scopes,
      input.campaignAccessType,
      campaignIds,
    );

    const row = await this.repo.replaceBranchAccess(
      ctx.companyId,
      id,
      input.campaignAccessType,
      campaignIds,
    );
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "CAMPAIGN_ACCESS_UPDATED", {
      campaignAccessType: input.campaignAccessType,
      campaignIds,
    });
    return mapApiKey(row);
  }

  async updateExpiration(
    ctx: TenantContext,
    id: string,
    expiresAt: string | null,
  ) {
    requireScope(ctx, PERMISSIONS.API_KEYS_WRITE);
    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new ApiKeyNotFoundError();

    let value: Date | null = null;
    if (expiresAt) {
      value = new Date(expiresAt);
      if (Number.isNaN(value.getTime())) {
        throw new ValidationError("Invalid expiration date");
      }
      if (value <= new Date()) {
        throw new ValidationError("Expiration must be in the future");
      }
    }

    const row = await this.repo.update(ctx.companyId, id, {
      expiresAt: value,
    });
    if (!row) throw new ApiKeyNotFoundError();
    await this.audit(ctx, id, "EXPIRATION_UPDATED", {
      expiresAt: toIso(value),
    });
    return mapApiKey(row);
  }
}

export const apiKeysService = new ApiKeysService();

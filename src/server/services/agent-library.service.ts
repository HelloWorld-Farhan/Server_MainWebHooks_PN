import { NotFoundError } from "@/server/lib/errors";
import { agentLibraryRepository } from "@/server/repositories/agent-library.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

function mapEntry(
  entry: NonNullable<
    Awaited<ReturnType<typeof agentLibraryRepository.findBySlug>>
  >,
) {
  return {
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    profile: entry.profile,
    category: entry.category,
    useCases: entry.useCases,
    defaultType: entry.defaultType,
    estimatedSetupMinutes: entry.estimatedSetupMinutes,
    samplePrompt: entry.samplePrompt,
    defaultFirstMessage: entry.defaultFirstMessage,
    defaultVariables: entry.defaultVariables,
    compatibleVoices: entry.compatibleVoices,
    demoAudioUrl: entry.demoAudioUrl,
    avatarGradient: entry.avatarGradient,
    sortOrder: entry.sortOrder,
  };
}

export class AgentLibraryService {
  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const entries = await agentLibraryRepository.findMany();
    return entries.map((entry) => mapEntry(entry));
  }

  async getBySlug(ctx: TenantContext, slug: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const entry = await agentLibraryRepository.findBySlug(slug);
    if (!entry || !entry.isPublished) {
      throw new NotFoundError("Library agent not found");
    }
    return mapEntry(entry);
  }
}

export const agentLibraryService = new AgentLibraryService();

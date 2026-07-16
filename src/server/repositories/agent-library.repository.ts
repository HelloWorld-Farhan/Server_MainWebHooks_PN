import type { AgentType, Prisma } from "@prisma/client";

import prisma from "@/server/lib/prisma";

export type UpsertAgentLibraryEntryData = {
  slug: string;
  name: string;
  profile: string;
  category: string;
  useCases: string[];
  defaultType: AgentType;
  estimatedSetupMinutes: number;
  samplePrompt: string;
  defaultFirstMessage: string;
  defaultVariables: Prisma.InputJsonValue;
  compatibleVoices: Prisma.InputJsonValue;
  demoAudioUrl: string;
  avatarGradient?: string;
  isPublished?: boolean;
  sortOrder?: number;
};

export class AgentLibraryRepository {
  findMany() {
    return prisma.agentLibraryEntry.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  findBySlug(slug: string) {
    return prisma.agentLibraryEntry.findUnique({
      where: { slug },
    });
  }

  upsertBySlug(data: UpsertAgentLibraryEntryData) {
    const { slug, ...rest } = data;
    return prisma.agentLibraryEntry.upsert({
      where: { slug },
      create: { slug, ...rest },
      update: rest,
    });
  }
}

export const agentLibraryRepository = new AgentLibraryRepository();

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.join(__dirname, "../../propnex-main-website");
const prisma = new PrismaClient({ log: ["error"] });

function loadManifest() {
  const manifestPath = path.join(websiteRoot, "public/agents/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.agents;
}

function loadProfile(slug) {
  const profilePath = path.join(websiteRoot, "public/agents", slug, "profile.json");
  return JSON.parse(readFileSync(profilePath, "utf8"));
}

function toAgentType(value) {
  return value.toUpperCase().replace(/-/g, "_");
}

function resolveDemoAudioUrl(slug, profile) {
  const demoPath = path.join(websiteRoot, "public/agents", slug, "demo.mp3");
  if (existsSync(demoPath)) {
    return `/agents/${slug}/demo.mp3`;
  }
  return profile.demoAudioUrl ?? "";
}

async function main() {
  console.log("=== Seeding Agent Library ===");
  const slugs = loadManifest();
  let upserted = 0;

  for (const slug of slugs) {
    const profile = loadProfile(slug);
    const demoAudioUrl = resolveDemoAudioUrl(slug, profile);
    await prisma.agentLibraryEntry.upsert({
      where: { slug: profile.slug },
      create: {
        slug: profile.slug,
        name: profile.name,
        profile: profile.profile,
        category: profile.category,
        useCases: profile.useCases,
        defaultType: toAgentType(profile.defaultType),
        estimatedSetupMinutes: profile.estimatedSetupMinutes,
        samplePrompt: profile.samplePrompt,
        defaultFirstMessage: profile.defaultFirstMessage,
        defaultVariables: profile.defaultVariables,
        compatibleVoices: profile.compatibleVoices,
        demoAudioUrl,
        avatarGradient: profile.avatarGradient ?? null,
        isPublished: true,
        sortOrder: profile.sortOrder ?? 0,
      },
      update: {
        name: profile.name,
        profile: profile.profile,
        category: profile.category,
        useCases: profile.useCases,
        defaultType: toAgentType(profile.defaultType),
        estimatedSetupMinutes: profile.estimatedSetupMinutes,
        samplePrompt: profile.samplePrompt,
        defaultFirstMessage: profile.defaultFirstMessage,
        defaultVariables: profile.defaultVariables,
        compatibleVoices: profile.compatibleVoices,
        demoAudioUrl,
        avatarGradient: profile.avatarGradient ?? null,
        isPublished: true,
        sortOrder: profile.sortOrder ?? 0,
      },
    });
    upserted += 1;
    console.log(`  upserted: ${profile.slug} (${profile.name})`);
  }

  const total = await prisma.agentLibraryEntry.count();
  console.log(`Done. Upserted ${upserted} entries. Total in DB: ${total}`);
}

main()
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

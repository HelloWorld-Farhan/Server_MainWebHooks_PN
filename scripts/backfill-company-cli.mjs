import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import randomstring from "randomstring";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

function deriveCliFromSlug(slug) {
  const letters = slug.replace(/[^a-zA-Z]/g, "").toUpperCase();
  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }
  return letters.padEnd(3, "X").slice(0, 3);
}

function generateCompanyCode() {
  return randomstring.generate({
    length: 6,
    charset: "alphanumeric",
    capitalization: "uppercase",
  });
}

async function cliExists(cli) {
  const result = await prisma.company.findRaw({
    filter: { cli },
    options: { projection: { _id: 1 }, limit: 1 },
  });
  return Array.isArray(result) && result.length > 0;
}

async function companyCodeExists(companyCode) {
  const result = await prisma.company.findRaw({
    filter: { companyCode },
    options: { projection: { _id: 1 }, limit: 1 },
  });
  return Array.isArray(result) && result.length > 0;
}

async function generateUniqueCliFromSlug(slug) {
  const base = deriveCliFromSlug(slug);

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : `${base.slice(0, 2)}${String.fromCharCode(65 + (attempt % 26))}`.slice(
            0,
            3,
          );

    if (!(await cliExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Failed to generate unique CLI for slug: ${slug}`);
}

async function generateUniqueCompanyCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const companyCode = generateCompanyCode();
    if (!(await companyCodeExists(companyCode))) {
      return companyCode;
    }
  }
  throw new Error("Failed to generate unique company code after 20 attempts");
}

async function main() {
  const companies = await prisma.company.findRaw({
    filter: {
      $or: [{ cli: null }, { cli: { $exists: false } }, { companyCode: null }, { companyCode: { $exists: false } }],
    },
    options: { projection: { _id: 1, name: 1, slug: 1, cli: 1, companyCode: 1 } },
  });

  const docs = Array.isArray(companies) ? companies : [];
  console.log(`Found ${docs.length} companies missing cli and/or companyCode`);

  for (const doc of docs) {
    const id = doc._id?.$oid ?? String(doc._id);
    const slug = doc.slug;
    const cli = doc.cli ?? (await generateUniqueCliFromSlug(slug));
    const companyCode = doc.companyCode ?? (await generateUniqueCompanyCode());

    await prisma.$runCommandRaw({
      update: "Company",
      updates: [
        {
          q: { _id: { $oid: id } },
          u: { $set: { cli, companyCode } },
        },
      ],
    });

    console.log(`Updated company ${id} (${doc.name}): cli=${cli}, companyCode=${companyCode}`);
  }

  console.log("Backfill complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

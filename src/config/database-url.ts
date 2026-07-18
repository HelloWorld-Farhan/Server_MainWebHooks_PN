function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.DATABASE_URL_ATLAS ?? "";
}

export function getDatabaseUrl(): string {
  const url = resolveDatabaseUrl();
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("serverSelectionTimeoutMS")) {
      parsed.searchParams.set("serverSelectionTimeoutMS", "10000");
    }
    if (!parsed.searchParams.has("connectTimeoutMS")) {
      parsed.searchParams.set("connectTimeoutMS", "10000");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

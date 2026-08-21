const DEVELOPMENT_AUTHORIZED_PARTIES = [
  'http://200.234.34.240:3000',
  'http://200.234.34.240:3001',
] as const;

type ClerkAuthEnvironment = {
  NODE_ENV?: string;
  MAIN_WEBSITE_URL?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
};

function normalizeOrigin(value: string): string {
  const candidate = value.trim();
  const url = new URL(candidate);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid Clerk authorized party "${candidate}": expected an http(s) origin`,
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Invalid Clerk authorized party "${candidate}": expected an origin without a path, query, or credentials`,
    );
  }

  return url.origin;
}

export function getClerkAuthorizedParties(
  env: ClerkAuthEnvironment = process.env,
): string[] {
  const configuredParties = [
    env.MAIN_WEBSITE_URL,
    ...(env.CLERK_AUTHORIZED_PARTIES?.split(',') ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));

  const candidates =
    env.NODE_ENV === 'production'
      ? configuredParties
      : [...configuredParties, ...DEVELOPMENT_AUTHORIZED_PARTIES];
  const parties = [...new Set(candidates.map(normalizeOrigin))];

  if (env.NODE_ENV === 'production') {
    if (parties.length === 0) {
      throw new Error(
        'MAIN_WEBSITE_URL or CLERK_AUTHORIZED_PARTIES must configure at least one production frontend origin',
      );
    }
    if (parties.some((party) => !party.startsWith('https://'))) {
      throw new Error(
        'Production Clerk authorized parties must use https origins',
      );
    }
  }

  return parties;
}

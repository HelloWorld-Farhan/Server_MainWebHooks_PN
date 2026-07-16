function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function companySlugFromName(name: string): string {
  const base = slugify(name) || "company";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/** Stable tenant key when Clerk Organizations are unavailable (must stay unique per user). */
export function localClerkOrganizationId(clerkUserId: string): string {
  return `local:${clerkUserId}`;
}

export function mapClerkRoleToUserRole(
  role: string,
): "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "SALES" | "SUPPORT" {
  switch (role) {
    case "org:admin":
      return "ADMIN";
    case "org:member":
      return "AGENT";
    default:
      if (role.includes("owner")) return "OWNER";
      if (role.includes("admin")) return "ADMIN";
      if (role.includes("manager")) return "MANAGER";
      if (role.includes("sales")) return "SALES";
      if (role.includes("support")) return "SUPPORT";
      return "AGENT";
  }
}

export function mapUserRoleToClerkRole(role: string): string {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return "org:admin";
    case "MANAGER":
      return "org:manager";
    case "SALES":
      return "org:sales";
    case "SUPPORT":
      return "org:support";
    default:
      return "org:member";
  }
}

/** Clerk invite roles — only built-in roles unless custom ones are configured in Clerk. */
export function mapUserRoleToClerkInviteRole(role: string): string {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return "org:admin";
    default:
      return "org:member";
  }
}

import type { Request } from "express";

import { requireTenantPermission } from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";

export function requireIntegrationsRead(req: Request) {
  return requireTenantPermission(req, PERMISSIONS.INTEGRATIONS_READ);
}

export function requireIntegrationsWrite(req: Request) {
  return requireTenantPermission(req, PERMISSIONS.INTEGRATIONS_WRITE);
}

export function requireAgentsRead(req: Request) {
  return requireTenantPermission(req, PERMISSIONS.AGENTS_READ);
}

export function requireAgentsWrite(req: Request) {
  return requireTenantPermission(req, PERMISSIONS.AGENTS_WRITE);
}

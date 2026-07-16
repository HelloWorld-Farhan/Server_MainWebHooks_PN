import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

export const requestStore = new AsyncLocalStorage<Request>();

export function getCurrentRequest(): Request | undefined {
  return requestStore.getStore();
}

export function runWithRequest<T>(req: Request, fn: () => T): T {
  return requestStore.run(req, fn);
}

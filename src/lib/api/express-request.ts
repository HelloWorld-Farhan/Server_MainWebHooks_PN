import type { Request as ExpressRequest } from "express";

export function toFetchRequest(req: ExpressRequest): Request {
  const url = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
  });
}

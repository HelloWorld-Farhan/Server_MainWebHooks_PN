import type { PageCacheParams } from "@/server/cache/keys";

export function parsePageCacheParams(
  searchParams: URLSearchParams,
): PageCacheParams {
  const filterRaw = searchParams.get("filter");
  let filter: Record<string, unknown> | undefined;
  if (filterRaw) {
    try {
      filter = JSON.parse(filterRaw) as Record<string, unknown>;
    } catch {
      filter = undefined;
    }
  }

  return {
    id: searchParams.get("id") ?? undefined,
    slug: searchParams.get("slug") ?? undefined,
    after: searchParams.get("after") ?? undefined,
    filter,
  };
}

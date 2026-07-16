export type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type Connection<T> = {
  edges: { node: T; cursor: string }[];
  pageInfo: PageInfo;
};

export function encodeCursor(startedAt: Date, id: string): string {
  return Buffer.from(`${startedAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { startedAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [iso, id] = decoded.split("|");
  if (!iso || !id) {
    throw new Error("Invalid cursor");
  }
  return { startedAt: new Date(iso), id };
}

export function encodeIdCursor(id: string, createdAt: Date): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeIdCursor(cursor: string): { createdAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [iso, id] = decoded.split("|");
  if (!iso || !id) {
    throw new Error("Invalid cursor");
  }
  return { createdAt: new Date(iso), id };
}

export function buildConnection<T extends { id: string }>(
  items: T[],
  limit: number,
  getCursor: (item: T) => string,
): Connection<T> {
  const hasNextPage = items.length > limit;
  const edges = (hasNextPage ? items.slice(0, limit) : items).map((node) => ({
    node,
    cursor: getCursor(node),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
  };
}

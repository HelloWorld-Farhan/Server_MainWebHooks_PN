import { yoga } from "@/server/graphql/yoga";

export async function executeGraphQLFromRequest<T>(
  request: Request,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = new URL("/graphql", request.url);
  const cookie = request.headers.get("cookie");

  const response = await yoga.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ query, variables }),
    }),
    {},
  );

  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "GraphQL error");
  }

  if (!json.data) {
    throw new Error("GraphQL response missing data");
  }

  return json.data;
}

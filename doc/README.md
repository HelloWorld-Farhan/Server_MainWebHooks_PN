# PropNex Main Server — API Documentation

Tenant dashboard backend (NestJS). Default base URL: `http://localhost:3004`.

| Resource | Path |
|---|---|
| REST + webhooks | See [rest-api.md](./rest-api.md) |
| GraphQL | See [graphql-api.md](./graphql-api.md) |
| Swagger UI | `GET /api/docs` (minimal metadata) |
| Health | `GET /` or `GET /health` |

## Authentication

| Mechanism | Used by | How |
|---|---|---|
| **Clerk session** | Most REST routes, GraphQL, page cache | Cookie or bearer token from `MAIN_WEBSITE_URL` / `CLERK_AUTHORIZED_PARTIES`; localhost is allowed only outside production |
| **Tenant context** | Tenant-scoped routes | Clerk user + active org → resolved company membership |
| **Permission guard** | Sensitive operations | Requires permission strings such as `agents:write`, `integrations:read` |
| **Svix HMAC** | Clerk webhook | Headers `svix-id`, `svix-timestamp`, `svix-signature` + `CLERK_WEBHOOK_SECRET` |
| **Service API key** | Internal dialer sync | Headers `x-agent-server-key`, `x-company-id` |

## Error format (REST)

Most REST endpoints return errors as:

```json
{ "error": "Human-readable message" }
```

Common status codes: `400` validation, `401` unauthorized, `403` forbidden, `404` not found, `500` server error.

## Source layout

| Area | Path |
|---|---|
| REST controllers | `src/modules/` |
| GraphQL schema | `src/server/graphql/schema/*.graphql` |
| GraphQL resolvers | `src/server/resolvers/` |
| Page cache loaders | `src/server/page-cache/loaders/` |

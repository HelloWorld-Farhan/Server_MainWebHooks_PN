# REST API Reference

Base URL: `http://localhost:3004` (or `PORT` env).

---

## Health & Meta

### `GET /`

**Auth:** None

**Response `200`:**

```json
{
  "service": "propnex-main-server",
  "status": "ok",
  "graphql": "/graphql",
  "docs": "/api/docs"
}
```

### `GET /health`

**Auth:** None

**Response `200`:**

```json
{ "status": "ok" }
```

---

## GraphQL HTTP Gateway

### `ALL /graphql` · `ALL /api/graphql`

**Auth:** Clerk session + organization

**Request body:**

```json
{
  "query": "query { viewer { id email } }",
  "variables": {},
  "operationName": "optional"
}
```

**Response:** Standard GraphQL JSON (`data` / `errors`). See [graphql-api.md](./graphql-api.md).

---

## Company

Source: `src/modules/company/company.controller.ts`

### `GET /api/company/contact`

**Auth:** Tenant context

**Response `200`:**

```json
{
  "contact": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+919876543210",
    "title": "Head of Sales"
  }
}
```

`contact` may be `null` if not set.

---

### `PUT /api/company/contact`

**Auth:** Tenant context + `settings:write`

**Request body:**

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+919876543210",
  "title": "Head of Sales"
}
```

| Field | Type | Required |
|---|---|---|
| `name` | string | Yes |
| `email` | string (email) | Yes |
| `phone` | string | No |
| `title` | string | No |

**Response `200`:** Same shape as GET (`{ "contact": { ... } }`).

**Response `400`:** `{ "error": "Name is required" }` (or other Zod validation message).

---

### `GET /api/company/contract`

**Auth:** Clerk `userId` (no org required)

**Response `200` (linked):**

```json
{
  "linked": true,
  "contractId": "PNX-ABC123",
  "claimedAt": "2026-01-15T10:30:00.000Z"
}
```

**Response `200` (not linked):**

```json
{ "linked": false }
```

---

### `POST /api/company/contract/link`

**Auth:** Clerk `userId`

**Request body:**

```json
{ "contractId": "PNX-ABC123" }
```

**Response `200`:**

```json
{
  "linked": true,
  "contractId": "PNX-ABC123",
  "claimedAt": "2026-07-16T09:00:00.000Z"
}
```

---

## Branch Invitations (Public)

Source: `src/modules/invitations/invitations.controller.ts`

### `GET /api/invitations/branch/:token`

**Auth:** None

**Response `200` (valid):**

```json
{
  "valid": true,
  "invitation": {
    "id": "clx...",
    "email": "admin@example.com",
    "status": "PENDING",
    "expiresAt": "2026-08-01T00:00:00.000Z",
    "branch": { "id": "br_1", "name": "Andheri" },
    "company": {
      "id": "co_1",
      "name": "Acme Realty",
      "clerkOrganizationId": "org_..."
    }
  }
}
```

**Response `200` (invalid):**

```json
{
  "valid": false,
  "error": "expired",
  "message": "This invitation expired on 8/1/2026...",
  "expiresAt": "2026-08-01T00:00:00.000Z"
}
```

`error` values: `not_found`, `accepted`, `cancelled`, `expired`, `not_pending`

---

### `POST /api/invitations/branch/:token/accept`

**Auth:** Clerk `userId` (session email must match invitation email)

**Request body:** None

**Response `200`:**

```json
{ "success": true }
```

**Response `401`:** `{ "error": "Unauthorized" }`

**Response `403`:** `{ "error": "Mismatched email" }`

**Response `400`:** `{ "error": "Invitation is no longer pending" }` or `{ "error": "Invitation has expired" }`

---

## Contact Requests (Public)

Source: `src/modules/company/company.controller.ts` (`ContactRequestsController`)

### `POST /api/contact-requests`

**Auth:** Public (optional Clerk session enriches `userId` / `companyId`)

**Request body:**

```json
{
  "name": "Alex Smith",
  "email": "alex@example.com",
  "reason": "SALES_PRICING",
  "planId": "payg",
  "message": "I'd like to learn about volume pricing."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | Max 200 chars |
| `email` | string | Yes | Valid email, max 320 |
| `reason` | enum | Yes | See reason values below |
| `planId` | enum | Yes | See plan IDs below |
| `message` | string | Yes | Max 5000 chars |

**`reason` values:** `GENERAL_INQUIRY`, `SALES_PRICING`, `TECHNICAL_SUPPORT`, `BILLING_CREDITS`, `BILLING_CHANNELS`, `ENTERPRISE_PLAN`, `ACCOUNT_ACCESS`, `OTHER`

**`planId` values:** `payg`, `volume`, `enterprise`, `not_sure`

**Response `200`:**

```json
{ "success": true, "requestId": "clx..." }
```

**Response `400`:**

```json
{ "error": "Message is required." }
```

---

## Agent Tools

Source: `src/modules/api/api.controllers.ts` (`AgentsController`)

### `GET /api/agents/:agentId/tools`

**Auth:** Tenant context

**Response `200`:**

```json
{
  "tools": [
    {
      "toolId": "faq",
      "enabled": true,
      "status": "enabled",
      "health": "healthy",
      "config": {
        "knowledgeSourceIds": [],
        "confidenceThreshold": 0.7,
        "fallbackResponse": "..."
      },
      "usage": {
        "totalExecutions": 12,
        "successRate": 0.95,
        "lastUsedAt": "2026-07-16T08:00:00.000Z",
        "errorCount": 1
      }
    }
  ]
}
```

**`toolId` values:** `faq`, `billing`, `google-calendar`, `google-sheets`

---

### `PUT /api/agents/:agentId/tools/:toolId`

**Auth:** Tenant context

**Request body:** Partial `AgentToolAssignment` (any subset of fields below)

```json
{
  "enabled": true,
  "status": "enabled",
  "health": "healthy",
  "config": { "confidenceThreshold": 0.8 },
  "usage": { "totalExecutions": 5, "successRate": 1, "lastUsedAt": null, "errorCount": 0 }
}
```

**Response `200`:**

```json
{ "tool": { /* full AgentToolAssignment */ } }
```

---

### `POST /api/agents/:agentId/tools/:toolId`

**Auth:** Tenant context

Runs a health check (no body). Simulates ~800ms delay and marks tool healthy.

**Response `200`:**

```json
{
  "tool": { /* updated AgentToolAssignment */ },
  "testResult": "passed"
}
```

---

## Contact Phone Upload

Source: `src/modules/api/api.controllers.ts` (`ContactPhonesController`)

### `POST /api/contact-phones/parse-upload`

**Auth:** Tenant context + `agents:write`

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | file | Yes | `.xlsx`, `.xls`, `.pdf`, `.docx`; max 50 MB |
| `defaultCountry` | string | No | ISO country code for unstructured files |

**Response `200`:**

```json
{
  "contacts": [
    {
      "phone": "+919876543210",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "address": "Mumbai",
      "branchNames": ["Andheri", "Bandra"]
    }
  ],
  "invalid": 2
}
```

**Response `400`:** `{ "error": "A file is required." }` or parse/validation errors.

---

## Agent Runtime Tools

Source: `src/modules/api/api.controllers.ts` (`ToolsController`)

### `POST /api/tools/billing/lookup`

**Auth:** Clerk session

**Request body:**

```json
{
  "permissions": {
    "creditAccess": true,
    "planAccess": true,
    "invoiceAccess": true
  }
}
```

All `permissions` fields default to `true` if omitted.

**Response `200` (all permissions):**

```json
{
  "credits": { "remaining": 5000, "total": 10000, "used": 5000 },
  "plan": { "name": "Pay-as-you-go", "resetDate": "2026-08-01" },
  "invoice": { "nextAmount": 0, "dueDate": "2026-08-01", "status": "paid" }
}
```

Only requested permission sections are included in the response.

---

### `POST /api/tools/faq/search`

**Auth:** Clerk session

**Request body:**

```json
{
  "query": "What are your pricing plans?",
  "agentId": "optional-agent-id"
}
```

**Response `200`:**

```json
{
  "answer": "PropNex AI offers flexible plans starting from pay-as-you-go credits...",
  "confidence": 0.92,
  "sources": ["Product FAQ"]
}
```

---

### `POST /api/tools/google-sheets/execute`

**Auth:** Tenant context + `agents:write`

**Request body (read):**

```json
{ "action": "read", "rowIndex": 0 }
```

**Response `200`:** `{ "row": { "customerName": "...", "phoneNumber": "..." } }`

**Request body (append):**

```json
{
  "action": "append",
  "data": { "customerName": "Alex", "phoneNumber": "+91..." }
}
```

**Response `200`:** `{ "row": { /* SheetRow */ } }`

**Request body (write / update):**

```json
{
  "action": "write",
  "rowIndex": 2,
  "data": { "notes": "Follow up next week" }
}
```

**Response `400`:** `{ "error": "rowIndex required" }` or `{ "error": "Invalid action" }`

---

### `POST /api/tools/google-calendar/events`

**Auth:** Tenant context + `agents:write`

**List events:**

```json
{ "action": "list" }
```

**Response `200`:** `{ "events": [ /* calendar events */ ] }`

**Create event:**

```json
{
  "action": "create",
  "title": "Site visit",
  "start": "2026-07-20T10:00:00.000Z",
  "end": "2026-07-20T10:30:00.000Z",
  "attendeeEmail": "lead@example.com"
}
```

**Response `200`:** `{ "event": { /* event object */ } }`

**Reschedule:**

```json
{
  "action": "reschedule",
  "eventId": "evt_123",
  "start": "2026-07-21T10:00:00.000Z",
  "end": "2026-07-21T10:30:00.000Z"
}
```

**Cancel:**

```json
{ "action": "cancel", "eventId": "evt_123" }
```

**Response `200`:** `{ "success": true }`

---

### `POST /api/tools/google-calendar/availability`

**Auth:** Tenant context + `agents:write`

**Request body:** None (empty body accepted)

**Response `200`:**

```json
{
  "available": true,
  "timezone": "Asia/Kolkata",
  "workingHours": {
    "monday": { "enabled": true, "start": "09:00", "end": "17:00" }
  },
  "meetingDurationMinutes": 30,
  "bufferMinutes": 15
}
```

---

## Integrations

Source: `src/modules/integrations/integrations.controller.ts`  
Prefix: `/api/integrations`

**Integration IDs:** `google-sheets`, `google-calendar`, `hubspot`, `salesforce`, `email`, `whatsapp`

### `GET /api/integrations`

**Auth:** Tenant context

**Response `200`:**

```json
{
  "integrations": [
    {
      "id": "google-sheets",
      "name": "Google Sheets",
      "status": "connected",
      "connectedAccount": "user@gmail.com",
      "lastSyncAt": "2026-07-16T07:00:00.000Z",
      "errorMessage": null,
      "sheetsConfig": { /* GoogleSheetsConfig */ },
      "calendarConfig": { /* GoogleCalendarConfig */ }
    }
  ]
}
```

---

### `GET /api/integrations/google/oauth/start`

**Auth:** Tenant context + `integrations:read`

**Query params:**

| Param | Required | Values |
|---|---|---|
| `integrationId` | Yes | `google-sheets` or `google-calendar` |

**Response `302`:** Redirect to Google OAuth URL.

**Response `400`:** `{ "error": "integrationId must be google-sheets or google-calendar" }`

---

### `GET /api/integrations/google/oauth/callback`

**Auth:** Tenant context (state must match company)

**Query params:** `code`, `state` (or `error` on failure)

**Response `302`:** Redirect to `{MAIN_WEBSITE_URL}/settings?tab=integrations&oauth_success=...` or `oauth_error=...`

---

### `POST /api/integrations/google/connect`

**Auth:** Tenant context + `integrations:write`

**Request body:**

```json
{ "integrationId": "google-sheets" }
```

**Response `200` (Clerk Google already connected):**

```json
{
  "integration": { /* WorkspaceIntegration */ },
  "authSource": "clerk"
}
```

**Response `200` (OAuth required):**

```json
{
  "oauthUrl": "https://accounts.google.com/...",
  "requiresOAuth": true
}
```

---

### `PUT /api/integrations/google/sheets/config`

**Auth:** Tenant context + `integrations:write`

**Request body (partial `GoogleSheetsConfig`):**

```json
{
  "spreadsheetId": "1abc...",
  "spreadsheetName": "PropNex Leads",
  "worksheetId": "0",
  "worksheetName": "Sheet1",
  "columnMappings": [
    {
      "propnexField": "customerName",
      "spreadsheetColumn": "Column A",
      "label": "Customer Name"
    }
  ],
  "autoSync": true
}
```

**Response `200`:** `{ "integration": { /* WorkspaceIntegration */ } }`

---

### `GET /api/integrations/google/sheets/spreadsheets`

**Auth:** Tenant context + `integrations:read`

**Response `200`:**

```json
{
  "spreadsheets": [
    {
      "id": "1abc...",
      "name": "PropNex Sheet",
      "modifiedAt": "2026-07-16T06:00:00.000Z",
      "webViewLink": "https://docs.google.com/..."
    }
  ]
}
```

---

### `POST /api/integrations/google/sheets/spreadsheets`  
### `POST /api/integrations/google/sheets/spreadsheets/create`

**Auth:** Tenant context + `integrations:write`

**Request body:**

```json
{
  "name": "PropNex Leads",
  "columns": [
    { "propnexField": "phoneNumber", "spreadsheetColumn": "Column A", "label": "Phone" }
  ]
}
```

**Response `200`:** `{ "spreadsheet": { /* SpreadsheetOption */ } }`

---

### `DELETE /api/integrations/google/sheets/spreadsheets`

**Auth:** Tenant context + `integrations:write`

**Query:** `spreadsheetId` (required)

**Response `200`:**

```json
{
  "integration": { /* WorkspaceIntegration */ },
  "spreadsheets": [ /* remaining spreadsheets */ ]
}
```

---

### `GET /api/integrations/google/sheets/worksheets`

**Auth:** Tenant context + `integrations:read`

**Query:** `spreadsheetId` (required)

**Response `200`:**

```json
{
  "worksheets": [
    { "id": "0", "name": "Sheet1", "rowCount": 150 }
  ]
}
```

---

### `GET /api/integrations/google/sheets/headers`

**Auth:** Tenant context + `integrations:read`

**Query:**

| Param | Required | Default |
|---|---|---|
| `spreadsheetId` | Yes | — |
| `worksheetName` | No | `Sheet1` |

**Response `200`:** `{ "headers": ["Name", "Phone", "Status"] }`

---

### `POST /api/integrations/google/sheets/sync`

**Auth:** Tenant context + `integrations:write`

**Request body:** None

**Response `200`:** `{ "integration": { /* updated with sync result */ } }`

**Response `500`:** `{ "error": "...", "integration": { /* partial state */ } }`

---

### `GET /api/integrations/google/sheets/sync-history`

**Auth:** Tenant context + `integrations:read`

**Response `200`:**

```json
{
  "history": [
    {
      "id": "sync_1",
      "startedAt": "2026-07-16T06:00:00.000Z",
      "completedAt": "2026-07-16T06:00:05.000Z",
      "result": "success",
      "rowsSynced": 42,
      "message": "Synced 42 row(s) successfully"
    }
  ]
}
```

---

### `PUT /api/integrations/google/calendar/config`

**Auth:** Tenant context + `integrations:write`

**Request body (partial `GoogleCalendarConfig`):**

```json
{
  "calendarId": "primary",
  "calendarName": "Work Calendar",
  "timezone": "Asia/Kolkata",
  "workingHours": {
    "monday": { "enabled": true, "start": "09:00", "end": "17:00" }
  },
  "meetingDurationMinutes": 30,
  "bufferMinutes": 15
}
```

**Response `200`:** `{ "integration": { /* WorkspaceIntegration */ } }`

---

### `GET /api/integrations/google/calendar/calendars`

**Auth:** Tenant context + `integrations:read`

**Response `200`:**

```json
{
  "calendars": [
    { "id": "primary", "name": "Work", "primary": true, "timezone": "Asia/Kolkata" }
  ]
}
```

---

### `GET /api/integrations/:id`

**Auth:** Tenant context

**Response `200`:** `{ "integration": { /* WorkspaceIntegration */ } }`

**Response `404`:** `{ "error": "Integration not found" }`

---

### `POST /api/integrations/:id/connect`

**Auth:** Tenant context

Non-Google integrations only. Google integrations return `400`.

**Response `200`:** `{ "integration": { /* WorkspaceIntegration */ } }`

---

### `POST /api/integrations/:id/disconnect`

**Auth:** Tenant context + `integrations:write`

**Response `200`:** `{ "integration": { /* WorkspaceIntegration */ } }`

---

## Page Cache

Source: `src/modules/page-cache/page-cache.controller.ts`

### `GET /api/page-cache/:pageKey`

**Auth:** Clerk session + org (via GraphQL context)

**Path `pageKey` values:**

`home`, `billing`, `call-logs`, `call-detail`, `agents`, `agent-detail`, `agent-library`, `agent-template`, `lead-reactivation`, `setup`, `settings`, `phone-detail`, `phone-contacts`

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `id` | string | Entity ID (e.g. call, agent, phone) |
| `slug` | string | Slug (e.g. agent template) |
| `after` | string | Pagination cursor |
| `filter` | JSON string | Page-specific filters |

**Response `200`:** Page-specific JSON from the matching loader (cached per company + params).

**Response `404`:** `{ "error": "Unknown page key" }`

---

## Internal (Service-to-Service)

Source: `src/modules/internal/internal.controller.ts`

### `POST /api/internal/dialer/sheets-sync`

**Auth:** Headers `x-agent-server-key` (matches env) + `x-company-id`

**Request body:**

```json
{ "callId": "call_abc123" }
```

**Response `200` (skipped):**

```json
{ "skipped": true, "reason": "Google Sheets integration is not connected" }
```

**Response `200` (success):**

```json
{
  "success": true,
  "spreadsheetId": "1abc...",
  "rowsAppended": 1
}
```

---

## Webhooks

Source: `src/modules/webhooks/webhooks.controller.ts`

### `POST /api/webhooks/clerk`

**Auth:** Svix signature (when `CLERK_WEBHOOKS_ENABLED=true`)

**Headers:** `svix-id`, `svix-timestamp`, `svix-signature`

**Request body:** Raw Clerk webhook event JSON (verified by Svix)

**Handled event types:**

- `user.created`, `user.updated`
- `organization.created`, `organization.updated`
- `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`

**Response `200` (processed):**

```json
{ "received": true }
```

**Response `200` (webhooks disabled in dev):**

```json
{
  "received": true,
  "skipped": true,
  "reason": "Clerk webhooks disabled; use direct API provisioning in dev"
}
```

**Response `400`:** `{ "error": "Missing svix headers" }` or `{ "error": "Invalid signature" }`

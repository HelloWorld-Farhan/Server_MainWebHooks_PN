# GraphQL API Reference

**Endpoints:** `POST /graphql` or `POST /api/graphql`  
**Auth:** Clerk session + active organization (required for all operations)

**Request format:**

```json
{
  "query": "...",
  "variables": { }
}
```

**Error responses** use standard GraphQL `errors` array. Unauthorized access throws before resolver execution.

Schema source: `src/server/graphql/schema/*.graphql`

---

## Root Query & Mutation

```graphql
type Query {
  viewer: Viewer!
  credits: CreditsQueries!
  billing: BillingQueries!
  callLogs: CallLogsQueries!
  analytics: AnalyticsQueries!
  agents: AgentsQueries!
  agentLibrary: AgentLibraryQueries!
  phoneNumbers: PhoneNumbersQueries!
  uploadedContacts: UploadedContactsQueries!
  leads: LeadsQueries!
  campaigns: CampaignsQueries!
  notifications: NotificationQueries!
  integrations: IntegrationQueries!
  scheduler: SchedulerQueries!
  events: EventQueries!
  branches: BranchesQueries!
  employees: EmployeesQueries!
}

type Mutation {
  credits: CreditsMutations!
  callLogs: CallLogsMutations!
  agents: AgentsMutations!
  phoneNumbers: PhoneNumbersMutations!
  uploadedContacts: UploadedContactsMutations!
  leads: LeadsMutations!
  branches: BranchesMutations!
  employees: EmployeesMutations!
}
```

---

## Viewer

Always available (no extra permission).

### Query

```graphql
query Viewer {
  viewer {
    id
    membershipId
    email
    firstName
    lastName
    role
    permissions
    branchAccessType
    branchIds
    company {
      id
      name
      slug
      contact { name email phone title }
    }
  }
}
```

### Response example

```json
{
  "data": {
    "viewer": {
      "id": "usr_1",
      "membershipId": "mem_1",
      "email": "admin@acme.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "OWNER",
      "permissions": ["agents:read", "agents:write", "billing:read"],
      "branchAccessType": "ALL",
      "branchIds": [],
      "company": {
        "id": "co_1",
        "name": "Acme Realty",
        "slug": "acme-realty",
        "contact": { "name": "Jane", "email": "jane@acme.com", "phone": null, "title": null }
      }
    }
  }
}
```

---

## Credits

**Permission:** `credits:read` (queries), `credits:write` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `credits.summary` | — | `CreditSummary` |
| `credits.usageHistory` | `first`, `after` | `CreditUsageConnection` |

```graphql
query Credits {
  credits {
    summary {
      remaining
      used
      total
      availablePercent
      renewalAt
      planId
    }
    usageHistory(first: 10) {
      edges {
        node { id amount reason description createdAt }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

**`CreditSummary` response shape:**

```json
{
  "remaining": 7500,
  "used": 2500,
  "total": 10000,
  "availablePercent": 75,
  "renewalAt": "2026-08-01T00:00:00.000Z",
  "planId": "payg"
}
```

### Mutations

| Field | Arguments | Returns | Permission |
|---|---|---|---|
| `credits.adjustCredits` | `amount: Int!`, `description: String!` | `CreditUsage` | `credits:write` |

```graphql
mutation AdjustCredits {
  credits {
    adjustCredits(amount: -100, description: "Manual adjustment") {
      id
      amount
      reason
      description
      createdAt
    }
  }
}
```

---

## Billing

**Permission:** `billing:read`

| Field | Arguments | Returns |
|---|---|---|
| `billing.subscription` | — | `BillingSubscription` |
| `billing.invoices` | `first`, `after` | `BillingInvoiceConnection` |

```graphql
query Billing {
  billing {
    subscription {
      id planId planName status
      currentPeriodStart currentPeriodEnd
      cancelAtPeriodEnd nextInvoiceAmount
    }
    invoices(first: 5) {
      edges {
        node {
          id amountCents currency status
          description issuedAt dueAt paidAt
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

**`BillingSubscription`:**

| Field | Type |
|---|---|
| `id` | ID! |
| `planId` | String! |
| `planName` | String! |
| `status` | `ACTIVE` \| `PAST_DUE` \| `CANCELED` \| `TRIALING` |
| `currentPeriodStart` | String! |
| `currentPeriodEnd` | String! |
| `cancelAtPeriodEnd` | Boolean! |
| `nextInvoiceAmount` | Int |

---

## Call Logs

**Permission:** `call_logs:read` (queries), `credits:write` (record completed)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `callLogs.recent` | `limit` | `[CallLog!]!` |
| `callLogs.connection` | `first`, `after`, `filter` | `CallLogConnection` |
| `callLogs.detail` | `id: ID!` | `CallLogDetail` |

**`CallLogFilter` input:**

```json
{
  "direction": "OUTBOUND",
  "status": "COMPLETED",
  "aiAgentId": "agent_1",
  "phoneNumberId": "phone_1",
  "assignedUserId": "usr_1",
  "dateFrom": "2026-07-01",
  "dateTo": "2026-07-31",
  "search": "mumbai"
}
```

```graphql
query CallLogs {
  callLogs {
    connection(first: 20, filter: { direction: OUTBOUND }) {
      edges {
        node {
          id direction status outcome
          startedAt durationSeconds
          creditsUsed aiAgent { id name }
          phoneNumber { id number }
          lead { id firstName phone }
        }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
    detail(id: "call_1") {
      id transcript { fullText segments }
      engagement sentiment aiSummary
    }
  }
}
```

### Mutations

| Field | Arguments | Returns |
|---|---|---|
| `callLogs.recordCallCompleted` | `callLogId: ID!`, `creditsUsed: Int!` | `Boolean!` |

---

## Analytics

**Permission:** `analytics:read`

| Field | Arguments | Returns |
|---|---|---|
| `analytics.summary` | `granularity`, `dateFrom`, `dateTo` | `AnalyticsSummary` |

```graphql
query Analytics {
  analytics {
    summary(granularity: DAILY, dateFrom: "2026-07-01", dateTo: "2026-07-31") {
      totalCalls connectedCalls conversionRate generatedLeads
      periodStart periodEnd
    }
  }
}
```

**Response:**

```json
{
  "totalCalls": 1200,
  "connectedCalls": 840,
  "conversionRate": 0.35,
  "generatedLeads": 294,
  "periodStart": "2026-07-01",
  "periodEnd": "2026-07-31"
}
```

---

## Agents

**Permission:** `agents:read` (queries), `agents:write` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `agents.statusSummary` | — | `AgentStatusSummary` |
| `agents.list` | — | `[AiAgent!]!` |
| `agents.byId` | `id: ID!` | `AiAgent` |

### Mutations

| Field | Arguments | Returns |
|---|---|---|
| `agents.create` | `input: CreateAgentInput!` | `AiAgent!` |
| `agents.update` | `id: ID!`, `input: UpdateAgentInput!` | `AiAgent!` |

**`CreateAgentInput`:**

```json
{
  "name": "Outbound Qualifier",
  "type": "outbound",
  "category": "sales",
  "environment": "production",
  "firstMessage": "Hi, this is Alex from Acme Realty.",
  "systemPrompt": "You qualify leads for property viewings.",
  "languages": ["en", "hi"],
  "voiceConfig": {},
  "modelConfig": {},
  "libraryEntryId": "lib_1",
  "branchId": "branch_1"
}
```

**`AiAgent` response (abbreviated):**

```json
{
  "id": "agent_1",
  "name": "Outbound Qualifier",
  "type": "outbound",
  "status": "ACTIVE",
  "enabled": true,
  "languages": ["en"],
  "createdAt": "2026-07-01T00:00:00.000Z",
  "updatedAt": "2026-07-16T00:00:00.000Z"
}
```

---

## Agent Library

**Permission:** `agents:read`

| Field | Arguments | Returns |
|---|---|---|
| `agentLibrary.list` | — | `[AgentLibraryEntry!]!` |
| `agentLibrary.bySlug` | `slug: String!` | `AgentLibraryEntry` |

```graphql
query AgentLibrary {
  agentLibrary {
    list {
      id slug name profile category useCases
      defaultType estimatedSetupMinutes samplePrompt
      defaultFirstMessage demoAudioUrl sortOrder
    }
    bySlug(slug: "lead-qualifier") {
      id name compatibleVoices defaultVariables
    }
  }
}
```

---

## Phone Numbers

**Permission:** `agents:read` (queries), `agents:write` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `phoneNumbers.list` | — | `[PhoneNumber!]!` |
| `phoneNumbers.byId` | `id: ID!` | `PhoneNumber` |

### Mutations

| Field | Arguments | Returns |
|---|---|---|
| `phoneNumbers.create` | `input: CreatePhoneNumberInput!` | `PhoneNumber!` |
| `phoneNumbers.update` | `id: ID!`, `input: UpdatePhoneNumberInput!` | `PhoneNumber!` |

**`CreatePhoneNumberInput`:**

```json
{
  "number": "+919876543210",
  "provider": "twilio",
  "label": "Mumbai outbound",
  "inboundAgentId": "agent_1",
  "outboundAgentId": "agent_2"
}
```

**`PhoneNumber` response:**

```json
{
  "id": "phone_1",
  "number": "+919876543210",
  "label": "Mumbai outbound",
  "provider": "twilio",
  "status": "active",
  "inboundCallsCount": 45,
  "outboundCallsCount": 120,
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

---

## Uploaded Contacts

**Permission:** `leads:read` (queries), `leads:write` (mutations)

### Queries

| Field | Returns |
|---|---|
| `uploadedContacts.list` | `[UploadedContact!]!` |

### Mutations

| Field | Arguments | Returns |
|---|---|---|
| `uploadedContacts.create` | `phone: String!` | `UploadedContact!` |
| `uploadedContacts.importContacts` | `contacts: [ImportedContactInput!]!` | `UploadedContactImportResult` |
| `uploadedContacts.delete` | `id: ID!` | `Boolean!` |
| `uploadedContacts.bulkDelete` | `ids: [ID!]!` | `Int!` |

**`ImportedContactInput`:**

```json
{
  "phone": "+919876543210",
  "name": "Ravi",
  "email": "ravi@example.com",
  "address": "Mumbai",
  "branchNames": ["Andheri"]
}
```

**`UploadedContactImportResult`:**

```json
{ "created": 10, "skipped": 2, "invalid": 1, "unmatchedBranches": ["Unknown Branch"] }
```

---

## Leads

**Permission:** `leads:read` (queries), `leads:write` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `leads.connection` | `first`, `after`, `filter` | `LeadConnection` |
| `leads.byId` | `id: ID!` | `Lead` |
| `leads.temperatureBreakdown` | — | `LeadTemperatureBreakdown` |

**`LeadFilter`:**

```json
{ "dormantOnly": true, "minDaysInactive": 30, "temperature": "hot" }
```

### Mutations

| Field | Arguments | Returns |
|---|---|---|
| `leads.importRows` | `rows: [LeadImportRowInput!]!` | `LeadImportResult` |

**`LeadImportRowInput`:**

```json
{
  "firstName": "Priya",
  "lastName": "Sharma",
  "email": "priya@example.com",
  "phone": "+919876543210",
  "temperature": "hot"
}
```

**`LeadImportResult`:**

```json
{ "hot": 5, "warm": 3, "cold": 2, "total": 10, "invalid": 0, "created": 8, "updated": 2 }
```

---

## Campaigns

**Permission:** `analytics:read`

| Field | Returns |
|---|---|
| `campaigns.list` | `[Campaign!]!` |

---

## Notifications

**Permission:** `notifications:read`

| Field | Arguments | Returns |
|---|---|---|
| `notifications.list` | `first`, `after` | `NotificationConnection` |

---

## Integrations (GraphQL)

**Permission:** `integrations:read`

| Field | Returns |
|---|---|
| `integrations.list` | `[Integration!]!` |

```json
{
  "id": "google-sheets",
  "type": "GOOGLE_SHEETS",
  "status": "CONNECTED",
  "connectedAccount": "user@gmail.com",
  "lastSyncAt": "2026-07-16T07:00:00.000Z"
}
```

> For connect/disconnect and Google OAuth, use the REST integrations API in [rest-api.md](./rest-api.md).

---

## Scheduler & Events

| Namespace | Field | Permission | Returns |
|---|---|---|---|
| `scheduler` | `upcoming(limit)` | `scheduler:read` | `[SchedulerEvent!]!` |
| `events` | `recent(limit)` | `events:read` | `[SystemEvent!]!` |

**`SystemEventType`:** `CALL_COMPLETED`, `LEAD_CREATED`, `AGENT_DEPLOYED`, `CREDIT_LOW`, `INTEGRATION_SYNC`, `BILLING_ALERT`

---

## Branches

**Permission:** `branches:read` (queries), `branches:write` / `branches:bulk` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `branches.connection` | `first`, `after`, `filter` | `BranchConnection` |
| `branches.byId` | `id: ID!` | `Branch` |
| `branches.contacts` | `branchId!`, `first`, `after` | `[BranchContact!]!` |
| `branches.callLogs` | `branchId!`, `first`, `after` | `[BranchCallLog!]!` |
| `branches.documents` | `branchId!` | `[BranchDocument!]!` |
| `branches.activities` | `branchId!`, `limit` | `[BranchActivity!]!` |
| `branches.agents` | `branchId!` | `[AiAgent!]!` |

**`BranchFilter`:**

```json
{ "search": "mumbai", "status": "ACTIVE", "aiEnabled": true }
```

### Mutations

| Field | Arguments | Returns | Permission |
|---|---|---|---|
| `branches.create` | `input: CreateBranchInput!` | `Branch!` | `branches:write` |
| `branches.update` | `id`, `input: UpdateBranchInput!` | `Branch!` | `branches:write` |
| `branches.updateAi` | `id`, `input: UpdateBranchAiInput!` | `Branch!` | `branches:write` |
| `branches.bulkUpdate` | `input: BulkBranchUpdateInput!` | `BulkBranchUpdateResult` | `branches:bulk` |
| `branches.archive` | `id: ID!` | `Branch!` | `branches:write` |
| `branches.resendInvitation` | `branchId: ID!` | `Branch!` | `branches:write` |
| `branches.cancelInvitation` | `branchId: ID!` | `Branch!` | `branches:write` |
| `branches.generateNewInvitation` | `branchId: ID!` | `Branch!` | `branches:write` |

**`CreateBranchInput`:**

```json
{
  "name": "Andheri Branch",
  "status": "ACTIVE",
  "address": "Andheri West, Mumbai",
  "phone": "+919876543210",
  "email": "andheri@acme.com",
  "aiEnabled": true,
  "systemPrompt": "You represent the Andheri office."
}
```

**`BulkBranchUpdateInput`:**

```json
{
  "ids": ["branch_1", "branch_2"],
  "action": "ENABLE_AI",
  "systemPrompt": "Optional prompt for UPDATE_PROMPT",
  "status": "ACTIVE"
}
```

**`BranchBulkAction`:** `ENABLE_AI`, `DISABLE_AI`, `UPDATE_PROMPT`, `CHANGE_STATUS`, `ARCHIVE`

**`Branch` response (abbreviated):**

```json
{
  "id": "branch_1",
  "name": "Andheri Branch",
  "status": "ACTIVE",
  "aiEnabled": true,
  "contactsCount": 120,
  "callLogsCount": 45,
  "agentsCount": 2,
  "invitation": {
    "id": "inv_1",
    "email": "manager@andheri.com",
    "status": "PENDING",
    "expiresAt": "2026-08-01T00:00:00.000Z"
  }
}
```

---

## Employees

**Permission:** `employees:read` (queries), `employees:write` / `employees:invite` (mutations)

### Queries

| Field | Arguments | Returns |
|---|---|---|
| `employees.connection` | `first`, `after`, `filter` | `EmployeeConnection` |
| `employees.byId` | `id: ID!` | `Employee` |
| `employees.permissionsForRole` | `role: UserRole!` | `[String!]!` |

**`EmployeeFilter`:**

```json
{ "search": "alex", "role": "MANAGER", "status": "ACTIVE", "branchId": "branch_1" }
```

### Mutations

| Field | Arguments | Returns | Permission |
|---|---|---|---|
| `employees.invite` | `input: InviteEmployeeInput!` | `Employee!` | `employees:invite` |
| `employees.update` | `id`, `input: UpdateEmployeeInput!` | `Employee!` | `employees:write` |
| `employees.deactivate` | `id: ID!` | `Employee!` | `employees:write` |
| `employees.delete` | `id: ID!` | `Boolean!` | `employees:write` |
| `employees.resendInvite` | `id: ID!` | `Employee!` | `employees:invite` |
| `employees.cancelInvite` | `id: ID!` | `Boolean!` | `employees:invite` |

**`InviteEmployeeInput`:**

```json
{
  "name": "Alex Manager",
  "email": "alex@acme.com",
  "role": "MANAGER",
  "jobTitle": "Branch Manager",
  "branchAccessType": "SELECTED",
  "branchIds": ["branch_1", "branch_2"]
}
```

**`Employee` response (abbreviated):**

```json
{
  "id": "emp_1",
  "userId": "usr_2",
  "name": "Alex Manager",
  "email": "alex@acme.com",
  "role": "MANAGER",
  "branchAccessType": "SELECTED",
  "assignedBranches": [{ "id": "branch_1", "name": "Andheri", "status": "ACTIVE" }],
  "status": "INVITED",
  "invitationStatus": "PENDING"
}
```

---

## Enums Reference

| Enum | Values |
|---|---|
| `AnalyticsGranularity` | `DAILY`, `WEEKLY`, `MONTHLY` |
| `CallDirection` | `INBOUND`, `OUTBOUND` |
| `CallStatus` | `COMPLETED`, `MISSED`, `VOICEMAIL`, `FAILED` |
| `BillingStatus` | `ACTIVE`, `PAST_DUE`, `CANCELED`, `TRIALING` |
| `InvoiceStatus` | `DRAFT`, `OPEN`, `PAID`, `VOID`, `UNCOLLECTIBLE` |
| `UserRole` | `OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `SALES`, `SUPPORT` |
| `MemberStatus` | `ACTIVE`, `INVITED`, `DEACTIVATED`, `REMOVED` |
| `BranchAccessType` | `ALL`, `SELECTED` |
| `AgentStatus` | `ACTIVE`, `INACTIVE` |
| `BranchStatus` | `ACTIVE`, `INACTIVE`, `ARCHIVED` |
| `IntegrationStatus` | `CONNECTED`, `NOT_CONNECTED`, `SYNCING`, `ERROR` |
| `SystemEventType` | `CALL_COMPLETED`, `LEAD_CREATED`, `AGENT_DEPLOYED`, `CREDIT_LOW`, `INTEGRATION_SYNC`, `BILLING_ALERT` |
| `BranchBulkAction` | `ENABLE_AI`, `DISABLE_AI`, `UPDATE_PROMPT`, `CHANGE_STATUS`, `ARCHIVE` |
| `BranchInvitationStatus` | `PENDING`, `ACCEPTED`, `EXPIRED`, `CANCELLED` |
| `InvitationDisplayStatus` | `PENDING`, `ACCEPTED`, `EXPIRED` |

**Scalars:** `DateTime`, `JSON`

---

## Pagination

Connection types (`*Connection`) use cursor-based pagination:

```json
{
  "edges": [{ "node": { /* entity */ }, "cursor": "opaque_cursor" }],
  "pageInfo": { "hasNextPage": true, "endCursor": "opaque_cursor" }
}
```

Pass `after: endCursor` on the next request with `first: N`.

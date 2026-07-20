# Lead Reactivation — Plan

## What it does

User uploads a Call Detail Report (CDR export from the dialer/campaign system —
columns: `call_id, campaignid, camp_name, callerId, phoneno, starttime, duration, callstatus`).
We filter out numbers whose call `duration < 5` seconds (a dud — no real
conversation happened, regardless of what `callstatus` says), queue those
leads for a callback, and retry through the agent server on a schedule:

- Attempt 1 — immediately
- Attempt 2 — 1 hour after attempt 1, only if attempt 1 was still `< 5s`
- Attempt 3 — 24 hours after attempt 2, only if attempt 2 was still `< 5s`
- Any attempt landing `>= 5s` stops the chain immediately
- Still `< 5s` after attempt 3 → give up, mark `FAILED`

## CSV/XLSX format (confirmed from a real sample)

- `phoneno` — bare 10-digit number, no country code, no name/email columns at all
- `duration` — seconds; `callstatus` ("Success"/"Failure") does **not** reliably
  track duration — rows with `duration=1` can still say `"Success"` — so the
  filter must be on `duration` alone, never `callstatus`
- `starttime` — Excel serial datetime, decode with the `xlsx` package's
  `cellDates: true` (already an installed dependency, no manual epoch math)
- Numbers can repeat across rows in a real export — dedupe by `phoneno`,
  keeping the lowest `duration` per number

## Architecture decision: no separate Redis/worker (for now)

Considered splitting retry scheduling into a BullMQ-backed worker process
with its own Redis, fully independent of the main server. Rejected for the
current stage:

- Telephony calling is still stubbed (`telephony.service.ts#testCall` is a
  `setTimeout`, not a real provider call) and the agent-server's call-trigger
  contract doesn't exist yet — too early to be solving a scaling problem.
- Would make Redis load-bearing (today it's an optional cache that degrades
  silently if absent) — a down/misconfigured Redis would silently stop
  reactivation calls with no error.
- Adds job-loss risk, dual-deploy contract coordination between producer and
  worker, duplicate-call idempotency handling, and a second process to run,
  scale, and monitor — all real costs with no current payoff at this volume
  (sample CDR was 50 rows).

**Instead:** drive retries with a cron poller inside the existing NestJS app,
using fields already on `Lead` (`queueStatus`, `nextFollowUpAt`). Zero new
infra. Revisit the BullMQ/worker split later if/when poll granularity or API
latency actually becomes a measured problem — `queueStatus`/`nextFollowUpAt`
stays the source of truth either way, so that's a mechanical swap of *what
triggers the retry*, not a rewrite.

## What already exists (reuse, don't rebuild)

| Need | Already there |
|---|---|
| CSV parsing / column guessing | `src/lib/csv-import.ts` (`parseCsv`, `guessColumnMapping`) |
| Phone normalization from upload | `src/lib/contact-phone-import.ts` |
| CSV → Lead upsert pattern | `leads.repository.ts#importRows` |
| Retry queue state | `Lead.queueStatus` (`PENDING/ASSIGNED/IN_CALL/COMPLETED/FAILED`) + `Lead.nextFollowUpAt` + `Lead.lastContactedAt` |
| Call duration data | `CallLog.durationSeconds` via `CallLogsRepository` |
| Inbound auth pattern to mirror | `lib/api/agent-server-auth.ts` (`x-agent-server-key`, `x-company-id`) |

Nothing currently triggers an outbound call — `internal.controller.ts` only
*receives* from the agent server (post-call sheet sync). The agent-server's
call-trigger endpoint (URL/auth/payload) needs to be confirmed before phase 3
below can be finished for real.

## Build order

Each phase is independently shippable and testable.

### 0. Unblock the external unknown

Get the agent-server's real call-trigger contract (URL, auth headers, payload
shape) before writing the caller in phase 3. If it's not ready yet, stub it
behind one function so everything else can still be built and tested.

### 1. Schema — one field

Add to `prisma/schema.prisma`:

```prisma
model Lead {
  // ...existing fields
  reactivationAttempts Int @default(0)
}
```

`prisma db push` (Mongo — no migration files needed). `queueStatus` and
`nextFollowUpAt` already exist; nothing else to add.

### 2. Upload → filter → enqueue (no calling yet)

New `modules/leads/reactivation.controller.ts`, same shape as
`TelephonyController` (zod-validated body, tenant context):

- `POST /api/leads/reactivation/upload`
- Parse with the `xlsx` package (`cellDates: true`)
- Dedupe by `phoneno`, keep lowest `duration`
- Filter `duration < 5`
- Upsert matched phones into `Lead` via the pattern in
  `leads.repository.ts`, with `queueStatus=PENDING`,
  `nextFollowUpAt=now`, `reactivationAttempts=0`
- Return counts (parsed / filtered / matched / invalid) to the UI

Ship and verify against the real CDR file before touching calling at all.

### 3. The call client, tested manually

`lib/integrations/agent-server-client.ts`:

```ts
placeCall(companyId: string, leadId: string, phone: string, aiAgentId: string): Promise<...>
```

POSTs to `AGENT_SERVER_URL` with the contract from phase 0. Trigger it once
by hand against one real lead to confirm it actually works before any
automation depends on it.

### 4. The cron poller — the retry engine

Add `@nestjs/schedule`. A `ReactivationScheduler` provider, `@Cron` every
1–2 minutes:

- Atomically claim due leads: `updateMany` where
  `queueStatus=PENDING AND nextFollowUpAt<=now AND reactivationAttempts<3`,
  flipping to `IN_CALL` in the same write so overlapping cron runs can't
  double-claim the same lead
- For each claimed lead, call `agentServerClient.placeCall(...)`

### 5. Outcome handling

Wherever the agent-server's result lands today (`recordCallCompleted`
mutation or the internal webhook) — when it's a reactivation lead:

- `duration >= 5` → `queueStatus = COMPLETED`
- `duration < 5` and attempts remain → `queueStatus = PENDING`,
  `nextFollowUpAt` = +1h (after attempt 1) or +24h (after attempt 2)
- attempts exhausted → `queueStatus = FAILED`

### 6. Test small

Run 2-3 real leads end-to-end, with the 1h/24h delays temporarily shortened
in a dev config so a full cycle can be watched without waiting a day.

### 7. Only if actually needed later

Swap the cron poller for BullMQ + a separate worker process, with Redis
split into its own logical DB/instance from the existing cache Redis. Do
this when poll granularity or API latency becomes a measured problem, not
before.

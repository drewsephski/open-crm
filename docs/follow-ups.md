# Follow-ups — read when touching detection, drafts, the queue or imports

The follow-up queue is the product's front door. It answers one question for a
business owner: **who is waiting on me, why, and what do I send them?**

## Where each part lives

| Part | File | Rule it keeps |
| --- | --- | --- |
| Detection rules | `apps/agent/agent/lib/follow-up-rules.ts` | Pure functions. No database, no model. Tested in `test/follow-up-rules.spec.ts`. |
| Detection pass | `apps/agent/agent/lib/follow-ups.ts` | Runs on the dispatch tick, at most every 15 minutes. No model, no credits. |
| Tunable numbers | `apps/agent/agent/lib/follow-up-config.ts` | Every threshold, cap and window. Nothing inline. |
| Draft session | `lib/follow-up-preamble.ts`, `tools/write_follow_up_draft.ts` | One research-lane task per draft. Budget 1, so no paid lookups. |
| Shared vocabulary | `@crm/db/follow-ups`, `@crm/validation/follow-up` | Status groups, the draft budget, the `signal` schema. |
| Queue API | `apps/api/src/follow-ups` | Lists, approves, dismisses. Decides nothing about a person. |
| Import API | `apps/api/src/imports` | Parses rows. Writes `IMPORT` records and dated history notes. |
| UI | `apps/app/app/(app)/[slug]/follow-ups`, `settings/import` | Review sheet, overview card, CSV mapper. |

**Intelligence stays in the agent.** The API never decides that somebody needs a
follow-up. It reads `FollowUp` rows the agent wrote, and it writes an `AgentTask`
when a rep asks for a draft.

## What is detected

One active follow-up per person, at most. `FollowUp.activeKey` is
`contact:<id>` while the row is active and `null` after it closes. The unique
index makes a duplicate impossible, not unlikely.

| Kind | Fires when | Priority |
| --- | --- | --- |
| `UNANSWERED` | Their last email has no reply after 24 hours, within 30 days | 900 + value |
| `PROPOSAL` | A deal in *Proposal sent* has had no touch for 3 days | 800 + value |
| `NO_REPLY` | Our last email has no answer after 5 days, within 45 days | 600 warm, 300 cold |
| `STALLED_DEAL` | An open deal has had no touch for 14 days | 500 + value |
| `DORMANT` | A real past conversation, quiet for 60 days to 2 years, no open deal | 200 |
| `NEVER_CONTACTED` | An imported person with no history at all. At most 25 open | 100 |

Nothing fires when:

- a meeting with them is booked in the next 14 days;
- we already sent 3 unanswered emails in a row;
- a deal with them closed in the last 30 days (no "no reply" after a win or a loss);
- a rep chose **Do not contact again** for them, ever;
- they were dismissed in the last 30 days, or resolved in the last 2 days.

"Touch" means an email in either direction, a past meeting, or a human `NOTE`,
`CALL` or `MEETING` activity. Agent-written notes (`meta.agent`, `meta.agentId`)
and undated imported notes (`meta.undated`) are not touches.

## The lifecycle

```
OPEN → DRAFTING → READY → APPROVED → SENT → REPLIED
  └──────────┴────────┴──→ SNOOZED → (wakes to OPEN or READY)
  └──────────┴────────┴──→ DISMISSED (who, when, why)
  └──────────┴────────┴──→ RESOLVED (the condition cleared by itself)
```

- **Nothing is sent by the CRM.** Approval completes before opening the mailbox.
  The reply action creates a Gmail or Outlook draft in the synced thread.
  The new email action opens a compose window.
  The rep sends the message. Mailbox sync confirms the send.
  Without a mailbox, the rep marks it sent.
- Reply drafts require `gmail.compose` or `Mail.ReadWrite`.
  Existing accounts reconnect to grant draft access.
  The approver opens only their own mailbox draft.
  Approved text cannot change through Save draft.
  A mailbox draft request blocks human edits and agent redrafts.
  Gmail sync excludes unsent drafts from conversation history and send confirmation.
- Repeated opens reuse the saved mailbox draft.
  A concurrent open during creation reports that the draft request is pending.
  The atomic claim commits before provider calls. No transaction holds a connection during provider calls.
  A changed status or recipient stops the draft from opening.
  The draft reference remains for audit. Review or delete the unsent draft in the mailbox.
  An uncertain provider request blocks automatic retries.
  The administrator checks the mailbox Drafts folder before clearing `mailboxDraftAttemptedAt` in Prisma Studio.
  Keep the marker after a draft exists. Save the provider draft link instead of creating another draft.
- **Approval is recorded** — `approvedById`, `approvedAt`, and the exact text in
  `draftSubject`/`draftBody`.
- **A transition only happens from the status the caller saw.** Every write is an
  `updateMany` guarded by the current status, so a double click or a race between
  the agent and a rep refuses rather than overwrites.
- **The draft tool cannot overwrite an approved draft.** It writes only from
  `OPEN` or `DRAFTING`.
- **A failed draft does not retry by itself.** The row returns to `OPEN` with
  `draftError`, and the rep chooses to ask again or write it.

## Cost

- Detection is SQL. It costs nothing.
- Drafts are capped at `FOLLOW_UPS.draft.autoPerDay` (10) automatic sessions a
  day, only for priority 200 and above. New imported leads are never drafted
  automatically. A rep asks for those one at a time.
- Each draft session has a budget of 1, which refuses every paid lookup
  (`spend(2)`). It reads CRM history only.
- Import does not research anything unless the rep ticks the box.

## Observability

- `AppSetting.followUpsScannedAt` and `followUpsScanError` are shown above the
  queue. A failed pass says so in the UI.
- `GET /internal/crm/dispatch-health` includes `followUps`, the counts of the last
  pass.
- `bun run --filter=agent follow-ups:scan` runs one pass now and prints the counts.

## Known limits

- Reply drafts need a thread synced from the approver's mailbox.
  Demo messages and imported notes lack provider message IDs.
  Use the new email action for those records.
- A changed Gmail subject starts another conversation.
  The reply action requires the original subject.
- Imports emit creation events in the same transaction as each new record.
  Re-imports emit no creation events for existing records. Research remains optional.
- Detection reads every active contact on each pass. It is fine for tens of
  thousands of contacts and is not built for millions.

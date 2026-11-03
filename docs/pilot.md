# Pilot — the offer, the demo, and onboarding a paying customer

Read with `docs/follow-ups.md` (what the product does) and `docs/setup.md`
(how an install is built).

## What we sell

**A sales follow-up system, set up and run for you.** It watches a small
service business's inbox and pipeline, tells the owner every morning who is
waiting on them, and has a personal follow-up drafted for each one. The owner
reads it, edits it if they want, and sends it from their own Gmail. Nothing
goes out without their click.

Who it is for: agencies, consultancies and local service firms with 1–10
people selling, a contact list, and no consistent follow-up habit.

The sentence for the call: *"Most small firms lose deals to silence, not to
competitors. This shows you every conversation that went quiet, why it
matters, and a reply ready to send."*

### Price

| | Founding pilot (first 3 customers) | Standard |
| --- | --- | --- |
| Setup, one-off | $750 | $1,500 |
| Monthly | $250 for months 1–3, then $400 | $400, up to 3 users |
| Term | Month to month | Month to month |

Setup includes: a private install on its own database, Gmail or Outlook
connection, import of their spreadsheet or CRM export, mapping their stages,
and a 45-minute walkthrough.

**Guarantee for the pilot:** if the queue does not surface at least five
conversations they agree were worth chasing in the first 14 days, the setup
fee is refunded. Detection runs on their real data within an hour of setup,
so this is low-risk to offer.

### The value they can see

The Follow-ups page shows it without anyone building a report:

- **Needs attention** — how many people are waiting on them now.
- **Pipeline waiting on you** — open deal value with a follow-up due.
- **Sent and replies (30 days)** — follow-ups sent from the queue, and how many
  got an answer, from their own mailbox.
- **Won after a follow-up (90 days)** — deals that closed after a follow-up from
  here.

Read these four numbers with the customer at the end of every month. They are
the renewal conversation.

## The 10-minute demo

Run it on a demo install, never on a customer's data.

```sh
bun run --filter=@crm/db db:demo        # a small agency's pipeline, 12 people
bun run --filter=agent follow-ups:scan  # detection, without waiting for the tick
```

1. **Overview.** "Waiting on you" is the first card. Eight people, $29.5k of
   open pipeline.
2. **Follow-ups.** Priya emailed two days ago asking for pricing and nobody
   answered. Marcus has had a $14.5k proposal sitting for nine days.
3. **Open Priya.** Show the reason, the deal, and the draft. Edit one word.
   Click **Approve and open in Gmail**. The compose window opens with the text.
4. **What it did not flag.** Sam was answered yesterday. Nina's proposal went
   out two days ago. Chris has a call booked on Thursday. Dana's deal is won.
   This is the trust moment: it does not nag about people who are fine.
5. **Sent.** Dana's follow-up got a reply and the deal closed. That is the
   "Won after a follow-up" number.
6. **Import.** Drop a CSV with a "Last contacted" column. It finds quiet
   relationships even without inbox history.

Remove the demo data with `bun run --filter=@crm/db db:demo -- --reset`.

Drafts need the agent running with `ANTHROPIC_API_KEY` for direct Anthropic model calls.
Without it every follow-up still appears, and the rep writes the draft.

## Onboarding a paying pilot

**One customer, one install.** The CRM is single-workspace by design
(`docs/api.md`). Do not put two customers in one database. Each pilot gets its
own Vercel projects (app, api, agent) and its own Neon database.

### Before the call

1. Create the three Vercel projects and one Neon database. Follow
   `docs/setup.md`.
2. Set `ALLOWED_SIGN_IN` to the customer's email domain.
3. Create the Google OAuth client **in the customer's own Google Workspace**,
   with the consent screen set to **Internal**. Gmail read access is a
   restricted scope. Internal skips Google's verification. An External app needs
   verification and an annual security assessment.
4. Set `AGENT_BRIDGE_SECRET` in the app and the agent, and `CRON_SECRET` in the
   API.
5. Have a Context.dev key ready. Onboarding asks for one and cannot be skipped.

### On the call (45 minutes)

1. The owner signs in with Google. The first account is the workspace owner.
2. Fill in the company name and website on onboarding.
3. **Settings → Connections:** connect Gmail. The sync starts at once.
4. **Settings → Import:** upload their contact export. Map the columns. Leave
   "research" off unless they want enrichment and you have priced the credits.
5. Click **Check now** on Follow-ups. Walk through the first real items
   together. Approve and send one live.

### The first two weeks

- Day 2: open their queue and check for false alarms. Dismiss with a reason; the
  reason is recorded.
- Day 7: a 15-minute check-in. Ask which follow-ups were worth it.
- Day 14: read the four numbers together. Decide on month two.

## Running it for yourself first

Run one install for LocalRedraft before selling it, on the same steps. Import
your prospect list with a "Last contacted" column, connect your Gmail, and use
the queue every morning for a week. Each false alarm you dismiss is something to
fix before a customer sees it. Each reply you get is a line for the sales call.

## What is not ready

- No billing. Invoice the setup fee and the monthly fee by hand (Stripe Invoices
  or Payment Links).
- No multi-tenant hosting. Each customer is a separate deployment.
- No in-thread Gmail replies. Approve opens a new compose window.
- No SMS or phone follow-ups.

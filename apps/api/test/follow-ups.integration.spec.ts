import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	DealStage,
	db,
	FollowUpDismissal,
	FollowUpKind,
	FollowUpStatus,
	RecordSource,
} from "@crm/db";
import { followUpActiveKey } from "@crm/db/follow-ups";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ConversionService } from "../src/currency/conversion.service";
import { FollowUpsService } from "../src/follow-ups/follow-ups.service";
import {
	amountFromText,
	dateFromText,
	ImportsService,
	splitName,
	stageFromText,
} from "../src/imports/imports.service";

const suffix = crypto.randomUUID().slice(0, 8);
const userId = `user-fu-api-${suffix}`;
const DOMAIN = `fu-api-${suffix}.test`;

const scans: number[] = [];
const drafts: string[] = [];

const agent = {
	followUpScanRequested: async () => {
		scans.push(Date.now());
	},
	followUpDraftRequested: async (followUp: { id: string }) => {
		drafts.push(followUp.id);
		return true;
	},
	companyCreated: async () => undefined,
	contactCreated: async () => true,
} as unknown as AgentTriggerService;

const conversion = new ConversionService(db);
const followUps = new FollowUpsService(db, conversion, agent);
const importAgent = new AgentTriggerService(db);
const imports = new ImportsService(conversion, importAgent);

const SIGNAL = {
	evidence: "email",
	daysQuiet: 6,
	lastInboundAt: null,
	lastOutboundAt: new Date().toISOString(),
	lastTouchAt: null,
	threadId: null,
	threadSubject: "Quote",
	dealStage: null,
} as const;

async function clear() {
	const contacts = await db.contact.findMany({
		where: { email: { endsWith: `@${DOMAIN}` } },
		select: { id: true },
	});
	const companies = await db.company.findMany({
		where: { domain: DOMAIN },
		select: { id: true },
	});
	const deals = await db.deal.findMany({
		where: { ownerId: userId },
		select: { id: true },
	});
	await db.agentTask.deleteMany({
		where: {
			OR: [
				{ contactId: { in: contacts.map((row) => row.id) } },
				{ companyId: { in: companies.map((row) => row.id) } },
				{ dealId: { in: deals.map((row) => row.id) } },
			],
		},
	});
	await db.followUp.deleteMany({
		where: { contact: { email: { endsWith: `@${DOMAIN}` } } },
	});
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.deal.deleteMany({ where: { ownerId: userId } });
	await db.contact.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
	await db.company.deleteMany({ where: { domain: DOMAIN } });
}

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Rep Api",
			email: `rep.${suffix}@example.test`,
			emailVerified: true,
		},
	});
});

afterAll(async () => {
	await clear();
	await db.user.deleteMany({ where: { id: userId } });
});

async function followUp(local: string) {
	const contact = await db.contact.create({
		data: { firstName: local, email: `${local}@${DOMAIN}` },
	});
	return db.followUp.create({
		data: {
			kind: FollowUpKind.NO_REPLY,
			contactId: contact.id,
			activeKey: followUpActiveKey(contact.id),
			reason: "No reply.",
			signal: SIGNAL,
			priority: 600,
			quietSince: new Date(),
		},
	});
}

describe("import parsing", () => {
	it("maps the words people use for stages", () => {
		expect(stageFromText("Proposal sent")).toBe(DealStage.CONTRACT_SENT);
		expect(stageFromText("Closed Won")).toBe(DealStage.CLOSED_WON);
		expect(stageFromText("unqualified")).toBe(DealStage.UNQUALIFIED_TO_BUY);
		expect(stageFromText("Qualified")).toBe(DealStage.QUALIFIED_TO_BUY);
		expect(stageFromText("")).toBeNull();
		expect(stageFromText("banana")).toBeNull();
	});

	it("reads amounts the way spreadsheets write them", () => {
		expect(amountFromText("$12,500")).toBe(12_500);
		expect(amountFromText("12.5k")).toBe(12_500);
		expect(amountFromText("€3000.50")).toBe(3000.5);
		expect(amountFromText("n/a")).toBeNull();
		expect(amountFromText("0")).toBeNull();
	});

	it("refuses dates in the future and nonsense", () => {
		const now = new Date("2026-11-03T00:00:00Z");
		expect(dateFromText("2026-09-01", now)?.toISOString()).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(dateFromText("2027-01-01", now)).toBeNull();
		expect(dateFromText("soon", now)).toBeNull();
	});

	it("finds a first name wherever it is", () => {
		expect(splitName({ fullName: "Ada Lovelace King" }, "a@x.test")).toEqual({
			firstName: "Ada",
			lastName: "Lovelace King",
		});
		expect(splitName({}, "jo.smith@x.test").firstName).toBe("Jo");
	});
});

describe("ImportsService", () => {
	it("creates companies, contacts, deals and history, and merges on re-import", async () => {
		await clear();
		const rows = [
			{
				fullName: "Dana Reyes",
				email: `dana@${DOMAIN}`,
				companyName: "Reyes Studio",
				website: `https://www.${DOMAIN}/about`,
				dealName: "Website rebuild",
				dealStage: "Proposal sent",
				dealAmount: "$8,000",
				lastContactedAt: "2026-08-01",
			},
			{ email: "not-an-email" },
		];

		const first = await imports.contacts(
			{ rows, firstRow: 2, research: false },
			userId,
		);
		expect(first.contactsCreated).toBe(1);
		expect(first.companiesCreated).toBe(1);
		expect(first.dealsCreated).toBe(1);
		expect(first.historyNotes).toBe(1);
		expect(first.skipped).toEqual([
			{ row: 3, reason: "No email address. Follow-ups need one." },
		]);

		const contact = await db.contact.findFirstOrThrow({
			where: { email: `dana@${DOMAIN}` },
			include: { deals: { include: { deal: true } } },
		});
		expect(contact.source).toBe(RecordSource.IMPORT);
		expect(contact.lastActivityAt?.toISOString()).toBe(
			"2026-08-01T00:00:00.000Z",
		);
		expect(contact.deals[0]?.deal.stage).toBe(DealStage.CONTRACT_SENT);
		expect(contact.deals[0]?.deal.stageChangedAt.toISOString()).toBe(
			"2026-08-01T00:00:00.000Z",
		);

		const again = await imports.contacts(
			{
				rows: [{ ...rows[0], title: "Founder" }],
				firstRow: 2,
				research: false,
			},
			userId,
		);
		expect(again.contactsCreated).toBe(0);
		expect(again.contactsUpdated).toBe(1);
		expect(again.dealsCreated).toBe(0);
		const events = await db.agentTask.findMany({
			where: {
				kind: "agent-event",
				OR: [
					{ contactId: contact.id },
					{ companyId: contact.companyId },
					{ dealId: contact.deals[0]?.dealId },
				],
			},
			select: { reason: true },
		});
		expect(events.map((event) => event.reason).sort()).toEqual([
			"company.created",
			"contact.created",
			"deal.created",
		]);
		expect(
			await db.agentTask.count({
				where: { contactId: contact.id, kind: "identify" },
			}),
		).toBe(0);
	});
});

describe("FollowUpsService", () => {
	it("approves once, then refuses a second approval", async () => {
		const row = await followUp("approve");
		const draft = {
			id: row.id,
			subject: "Re: Quote",
			body: "Hi, any thoughts?",
		};

		const approved = await followUps.approve(draft, userId);
		expect(approved.status).toBe(FollowUpStatus.APPROVED);

		await expect(followUps.approve(draft, userId)).rejects.toThrow(
			"already been handled",
		);

		const stored = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.approvedById).toBe(userId);
		expect(stored.draftBody).toBe("Hi, any thoughts?");
		expect(stored.activeKey).not.toBeNull();
	});

	it("keeps mailbox draft text immutable after snoozing and renewed approval", async () => {
		const row = await followUp("mailbox-locked");
		const draft = {
			id: row.id,
			subject: "Re: Quote",
			body: "The approved message.",
		};
		await followUps.approve(draft, userId);
		await db.followUp.update({
			where: { id: row.id },
			data: {
				mailboxDraftAttemptedAt: new Date(),
				mailboxDraftId: "saved-provider-draft",
				mailboxDraftUserId: userId,
				mailboxDraftProvider: "gmail",
			},
		});
		await followUps.snooze(row.id, 3);
		await expect(
			followUps.saveDraft({ ...draft, body: "Changed text." }, userId),
		).rejects.toThrow("mailbox draft");
		await expect(
			followUps.approve({ ...draft, body: "Changed text." }, userId),
		).rejects.toThrow("Keep the approved text");
		await expect(followUps.approve(draft, "another-user")).rejects.toThrow(
			"Keep the approved text",
		);
		expect((await followUps.approve(draft, userId)).status).toBe(
			FollowUpStatus.APPROVED,
		);
		const stored = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.draftBody).toBe(draft.body);
		expect(stored.mailboxDraftId).toBe("saved-provider-draft");
	});

	it("marks sent and frees the person for future follow-ups", async () => {
		const row = await followUp("sent");
		const sent = await followUps.markSent(row.id, userId);
		expect(sent.status).toBe(FollowUpStatus.SENT);
		const stored = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.activeKey).toBeNull();
		expect(stored.sentAt).not.toBeNull();
		expect(stored.approvedById).toBe(userId);
	});

	it("records who dismissed it and why", async () => {
		const row = await followUp("dismiss");
		await followUps.dismiss(row.id, FollowUpDismissal.DO_NOT_CONTACT, userId);
		const stored = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.status).toBe(FollowUpStatus.DISMISSED);
		expect(stored.dismissal).toBe(FollowUpDismissal.DO_NOT_CONTACT);
		expect(stored.dismissedById).toBe(userId);
		expect(stored.activeKey).toBeNull();
	});

	it("snoozes and lists by view", async () => {
		const row = await followUp("snooze");
		await followUps.snooze(row.id, 7);
		const closed = await followUps.list({ view: "closed", limit: 200 });
		expect(closed.rows.some((entry) => entry.id === row.id)).toBe(true);
		const todo = await followUps.list({ view: "todo", limit: 200 });
		expect(todo.rows.some((entry) => entry.id === row.id)).toBe(false);
	});

	it("hands a draft request to the agent queue", async () => {
		const row = await followUp("draft");
		await followUps.requestDraft(row.id);
		expect(drafts).toContain(row.id);
	});

	it("summarises the queue", async () => {
		const summary = await followUps.summary(userId);
		expect(summary.todo).toBeGreaterThanOrEqual(1);
		expect(summary.sent).toBeGreaterThanOrEqual(1);
		expect(summary.mailbox).toBeNull();
	});
});

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import {
	DealStage,
	db,
	EmailDirection,
	FollowUpDismissal,
	FollowUpKind,
	FollowUpStatus,
	RecordSource,
} from "@crm/db";
import { brief, taskAuth } from "../agent/lib/dispatch";
import { followUpPreamble } from "../agent/lib/follow-up-preamble";
import { saveFollowUpDraft, scanFollowUps } from "../agent/lib/follow-ups";

const DAY = 24 * 60 * 60 * 1000;
const suffix = crypto.randomUUID().slice(0, 8);
const DOMAIN = `fu-${suffix}.example.test`;

let userId = "";

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * DAY);
}

async function clear() {
	const contacts = await db.contact.findMany({
		where: { email: { endsWith: `@${DOMAIN}` } },
		select: { id: true },
	});
	const ids = contacts.map((row) => row.id);
	await db.agentTask.deleteMany({ where: { contactId: { in: ids } } });
	await db.followUp.deleteMany({ where: { contactId: { in: ids } } });
	await db.emailThread.deleteMany({
		where: { rootMessageId: { endsWith: `@${DOMAIN}>` } },
	});
	await db.deal.deleteMany({ where: { company: { domain: DOMAIN } } });
	await db.contact.deleteMany({ where: { id: { in: ids } } });
	await db.company.deleteMany({ where: { domain: DOMAIN } });
}

async function person(
	local: string,
	source: RecordSource = RecordSource.EMAIL,
): Promise<{ id: string; companyId: string }> {
	const company =
		(await db.company.findFirst({ where: { domain: DOMAIN } })) ??
		(await db.company.create({
			data: { name: `Follow Up Co ${suffix}`, domain: DOMAIN },
		}));
	return db.contact.create({
		data: {
			firstName: local,
			email: `${local}@${DOMAIN}`,
			companyId: company.id,
			source,
		},
		select: { id: true, companyId: true },
	}) as Promise<{ id: string; companyId: string }>;
}

async function message(
	contactId: string,
	direction: EmailDirection,
	sentAt: Date,
	subject = "Website quote",
) {
	const rootMessageId = `<root-${contactId}@${DOMAIN}>`;
	const thread = await db.emailThread.upsert({
		where: { rootMessageId },
		create: {
			rootMessageId,
			subject,
			contactId,
			firstMessageAt: sentAt,
			lastMessageAt: sentAt,
		},
		update: { lastMessageAt: sentAt },
	});
	await db.emailMessage.create({
		data: {
			threadId: thread.id,
			rfcMessageId: `<${crypto.randomUUID()}@${DOMAIN}>`,
			direction,
			fromEmail: "someone@example.test",
			recipients: [],
			subject,
			sentAt,
		},
	});
}

async function active(contactId: string) {
	return db.followUp.findFirst({
		where: { contactId, activeKey: { not: null } },
	});
}

beforeAll(async () => {
	const user = await db.user.create({
		data: {
			id: `user-fu-${suffix}`,
			name: "Rep Follow",
			email: `rep.fu.${suffix}@example.test`,
			emailVerified: true,
		},
		select: { id: true },
	});
	userId = user.id;
});

beforeEach(clear);

afterAll(async () => {
	await clear();
	await db.user.deleteMany({ where: { id: userId } });
});

describe("scanFollowUps", () => {
	it("raises one follow-up per person and does not duplicate it", async () => {
		const sarah = await person("sarah");
		await message(sarah.id, EmailDirection.INBOUND, daysAgo(3));

		await scanFollowUps({ force: true });
		await scanFollowUps({ force: true });

		const rows = await db.followUp.findMany({ where: { contactId: sarah.id } });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe(FollowUpKind.UNANSWERED);
		expect(rows[0]?.reason).toContain("Website quote");
	});

	it("attaches the deal and prefers a quiet proposal", async () => {
		const tom = await person("tom");
		await message(tom.id, EmailDirection.OUTBOUND, daysAgo(8));
		const deal = await db.deal.create({
			data: {
				name: "Brand refresh",
				companyId: tom.companyId,
				ownerId: userId,
				stage: DealStage.CONTRACT_SENT,
				stageChangedAt: daysAgo(8),
			},
		});
		await db.dealContact.create({
			data: { dealId: deal.id, contactId: tom.id },
		});

		await scanFollowUps({ force: true });

		const row = await active(tom.id);
		expect(row?.kind).toBe(FollowUpKind.PROPOSAL);
		expect(row?.dealId).toBe(deal.id);
	});

	it("resolves itself when the rep replies outside the queue", async () => {
		const ana = await person("ana");
		await message(ana.id, EmailDirection.INBOUND, daysAgo(3));
		await scanFollowUps({ force: true });

		await message(ana.id, EmailDirection.OUTBOUND, daysAgo(0.1));
		await scanFollowUps({ force: true });

		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: ana.id },
		});
		expect(row.status).toBe(FollowUpStatus.RESOLVED);
		expect(row.activeKey).toBeNull();
		expect(row.resolution).toBe("You replied.");
	});

	it("confirms an approved send from the mailbox, then counts the reply", async () => {
		const leo = await person("leo");
		await message(leo.id, EmailDirection.OUTBOUND, daysAgo(7));
		await message(leo.id, EmailDirection.INBOUND, daysAgo(9));
		await scanFollowUps({ force: true });

		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: leo.id },
		});
		await db.followUp.update({
			where: { id: row.id },
			data: {
				status: FollowUpStatus.APPROVED,
				approvedAt: daysAgo(0.5),
				approvedById: userId,
			},
		});

		await message(leo.id, EmailDirection.OUTBOUND, daysAgo(0.4));
		await scanFollowUps({ force: true });
		expect(
			(await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).status,
		).toBe(FollowUpStatus.SENT);

		await message(leo.id, EmailDirection.INBOUND, daysAgo(0.1));
		await scanFollowUps({ force: true });
		const replied = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(replied.status).toBe(FollowUpStatus.REPLIED);
		expect(replied.repliedAt).not.toBeNull();
	});

	it("never raises a follow-up for someone marked do-not-contact", async () => {
		const max = await person("max");
		await message(max.id, EmailDirection.INBOUND, daysAgo(3));
		await scanFollowUps({ force: true });

		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: max.id },
		});
		await db.followUp.update({
			where: { id: row.id },
			data: {
				status: FollowUpStatus.DISMISSED,
				dismissal: FollowUpDismissal.DO_NOT_CONTACT,
				dismissedAt: daysAgo(60),
				activeKey: null,
			},
		});

		await scanFollowUps({ force: true });
		expect(await db.followUp.count({ where: { contactId: max.id } })).toBe(1);
	});

	it("queues a draft task for a high-priority follow-up", async () => {
		const kim = await person("kim");
		await message(kim.id, EmailDirection.INBOUND, daysAgo(2));
		await scanFollowUps({ force: true });

		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: kim.id },
		});
		expect(row.status).toBe(FollowUpStatus.DRAFTING);
		const task = await db.agentTask.findUniqueOrThrow({
			where: { id: row.draftTaskId ?? "" },
		});
		expect(task.kind).toBe("follow-up");
		expect(task.payload).toEqual({
			followUpId: row.id,
			kind: FollowUpKind.UNANSWERED,
		});

		await db.agentTask.update({
			where: { id: task.id },
			data: { finishedAt: new Date(), outcome: "Model unavailable." },
		});
		await scanFollowUps({ force: true });
		const released = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(released.status).toBe(FollowUpStatus.OPEN);
		expect(released.draftError).toContain("Model unavailable.");
	});

	it("only scans once per interval unless forced", async () => {
		await scanFollowUps();
		const second = await scanFollowUps();
		expect(second.ran).toBe(false);
	});

	it("routes a draft task to a follow-up session with everything it needs", async () => {
		const ivy = await person("ivy");
		await message(ivy.id, EmailDirection.INBOUND, daysAgo(2), "Pricing");
		await scanFollowUps({ force: true });

		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: ivy.id },
		});
		const task = await db.agentTask.findUniqueOrThrow({
			where: { id: row.draftTaskId ?? "" },
		});

		const auth = taskAuth({ ...task, payload: task.payload });
		expect(auth.attributes?.followUpId).toBe(row.id);
		expect(auth.attributes?.taskKind).toBe("follow-up");
		expect(brief({ ...task, payload: task.payload })).toContain(
			"write_follow_up_draft",
		);
		expect(task.budget).toBe(1);

		const preamble = await followUpPreamble(row.id);
		expect(preamble?.markdown).toContain(row.id);
		expect(preamble?.markdown).toContain(ivy.id);
		expect(preamble?.markdown).toContain("“Pricing”");
		expect(preamble?.markdown).toContain("Never invent");
		expect(preamble?.focus.contactId).toBe(ivy.id);
	});

	it("saves a draft once, and never over an approved follow-up", async () => {
		const zoe = await person("zoe");
		await message(zoe.id, EmailDirection.INBOUND, daysAgo(2));
		await scanFollowUps({ force: true });
		const row = await db.followUp.findFirstOrThrow({
			where: { contactId: zoe.id },
		});

		const draft = { subject: "Re: Website quote", body: "Hi Zoe", note: "n" };
		expect(await saveFollowUpDraft(row.id, "session-1", draft)).toBe(true);
		const saved = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(saved.status).toBe(FollowUpStatus.READY);
		expect(saved.draftSessionId).toBe("session-1");

		await db.followUp.update({
			where: { id: row.id },
			data: { status: FollowUpStatus.APPROVED },
		});
		expect(
			await saveFollowUpDraft(row.id, "session-2", { ...draft, body: "Other" }),
		).toBe(false);
		const kept = await db.followUp.findUniqueOrThrow({ where: { id: row.id } });
		expect(kept.draftBody).toBe("Hi Zoe");
	});
});

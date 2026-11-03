import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import { GMAIL_DRAFT_SCOPE, OUTLOOK_DRAFT_SCOPE } from "@crm/auth/scopes";
import { db } from "@crm/db";
import {
	FollowUpMailboxService,
	gmailReplyRaw,
} from "../src/follow-ups/follow-up-mailbox.service";
import { MailboxTokenService } from "../src/mailbox/mailbox-token.service";
import { rootMessageIdFrom } from "../src/mailbox/message-text";

const suffix = crypto.randomUUID();
const userId = `mailbox-${suffix}`;
const tokens = new MailboxTokenService(db);
const service = new FollowUpMailboxService(db, tokens);
let contactId = "";
let threadId = "";
const restores: (() => void)[] = [];

beforeAll(async () => {
	await db.user.create({
		data: { id: userId, name: "Mailbox rep", email: `${userId}@example.test` },
	});
	contactId = (
		await db.contact.create({
			data: { firstName: "Mailbox", email: `${suffix}@contact.test` },
		})
	).id;
	threadId = (
		await db.emailThread.create({
			data: {
				rootMessageId: `<root-${suffix}@contact.test>`,
				contactId,
				firstMessageAt: new Date(),
				lastMessageAt: new Date(),
			},
		})
	).id;
	await db.emailMessage.create({
		data: {
			threadId,
			rfcMessageId: `<${suffix}@contact.test>`,
			syncedByUserId: userId,
			gmailMessageId: "original-message",
			fromEmail: `${suffix}@contact.test`,
			direction: "INBOUND",
			recipients: [],
			subject: "Quote",
			sentAt: new Date(),
		},
	});
});

afterEach(() => {
	for (const restore of restores.splice(0)) restore();
});
afterAll(async () => {
	await db.followUp.deleteMany({ where: { contactId } });
	await db.emailThread.deleteMany({ where: { id: threadId } });
	await db.contact.deleteMany({ where: { id: contactId } });
	await db.user.deleteMany({ where: { id: userId } });
});

async function followUp(approved = true) {
	return db.followUp.create({
		data: {
			kind: "UNANSWERED",
			status: approved ? "APPROVED" : "READY",
			approvedById: approved ? userId : null,
			approvedAt: approved ? new Date() : null,
			contactId,
			reason: "Needs reply",
			priority: 900,
			quietSince: new Date(),
			draftSubject: "Re: Quote",
			draftBody: "Thanks for asking. Let us talk.",
			signal: {
				evidence: "email",
				daysQuiet: 2,
				lastInboundAt: new Date().toISOString(),
				lastOutboundAt: null,
				lastTouchAt: null,
				threadId,
				threadSubject: "Quote",
				dealStage: null,
			},
		},
	});
}

function grant(grantedScopes: string[] = [GMAIL_DRAFT_SCOPE]) {
	const scopes = spyOn(tokens, "grantedScopes").mockResolvedValue(
		new Set(grantedScopes),
	);
	const token = spyOn(tokens, "accessTokenFor").mockResolvedValue({
		outcome: "ok",
		accessToken: "test-token",
	});
	restores.push(
		() => scopes.mockRestore(),
		() => token.mockRestore(),
	);
}

describe("mailbox reply drafts", () => {
	it("refuses unapproved drafts and another approver's mailbox", async () => {
		const row = await followUp(false);
		await expect(service.openDraft(row.id, userId)).rejects.toThrow(
			"Approve this follow-up",
		);
		const approved = await followUp();
		await expect(
			service.openDraft(approved.id, "another-user"),
		).rejects.toThrow("Approve this follow-up");
	});

	it("requires draft access before calling the provider", async () => {
		const row = await followUp();
		await expect(service.openDraft(row.id, userId)).rejects.toThrow(
			"Reconnect Google",
		);
	});

	it("creates one threaded draft for concurrent opens and reuses its link", async () => {
		grant();
		const row = await followUp();
		let writes = 0;
		let raw = "";
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					const url = String(input);
					if (url.endsWith("/drafts/draft-id?format=metadata"))
						return Response.json({
							id: "draft-id",
							message: { id: "edited-draft-message" },
						});
					if (url.endsWith("?format=metadata"))
						return Response.json({ threadId: "provider-thread" });
					expect(url).toBe(
						"https://gmail.googleapis.com/gmail/v1/users/me/drafts",
					);
					expect(init?.method).toBe("POST");
					const payload = JSON.parse(String(init?.body));
					expect(payload.message.threadId).toBe("provider-thread");
					raw = Buffer.from(payload.message.raw, "base64url").toString();
					writes += 1;
					return Response.json({
						id: "draft-id",
						message: { id: "draft-message" },
					});
				},
				{ preconnect: fetch.preconnect },
			),
		);
		restores.push(() => fetcher.mockRestore());
		const results = await Promise.all([
			service.openDraft(row.id, userId),
			service.openDraft(row.id, userId),
		]);
		expect(writes).toBe(1);
		expect(results.map((result) => new URL(result.url).hash).sort()).toEqual([
			"#drafts?compose=draft-message",
			"#drafts?compose=edited-draft-message",
		]);
		expect(
			(await db.followUp.findUniqueOrThrow({ where: { id: row.id } }))
				.mailboxDraftId,
		).toBe("draft-id");
		expect(raw).toContain(`In-Reply-To: <${suffix}@contact.test>`);
		expect(raw).toContain(
			`References: <root-${suffix}@contact.test> <${suffix}@contact.test>`,
		);
		expect(raw).toContain(`To: ${suffix}@contact.test`);
		expect(
			rootMessageIdFrom({
				references:
					raw
						.split("\r\n")
						.find((line) => line.startsWith("References: "))
						?.slice("References: ".length) ?? null,
				inReplyTo: null,
				messageId: null,
			}),
		).toBe(`root-${suffix}@contact.test`);
		expect(
			(await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).status,
		).toBe("APPROVED");
	});

	it("keeps approval and exposes provider failures", async () => {
		grant();
		const row = await followUp();
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: Parameters<typeof fetch>[0]) =>
					String(input).endsWith("?format=metadata")
						? Response.json({ threadId: "provider-thread" })
						: new Response("", { status: 503 }),
				{ preconnect: fetch.preconnect },
			),
		);
		restores.push(() => fetcher.mockRestore());
		await expect(service.openDraft(row.id, userId)).rejects.toThrow(
			"No email is sent",
		);
		const stored = await db.followUp.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.status).toBe("APPROVED");
		expect(stored.mailboxDraftId).toBeNull();
		expect(stored.mailboxDraftAttemptedAt).not.toBeNull();
		await expect(service.openDraft(row.id, userId)).rejects.toThrow(
			"previous mailbox draft request",
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("creates and fills an Outlook reply draft without sending it", async () => {
		grant([OUTLOOK_DRAFT_SCOPE]);
		const row = await followUp();
		await db.emailMessage.updateMany({
			where: { threadId },
			data: { gmailMessageId: null, outlookMessageId: "outlook-original" },
		});
		const calls: string[] = [];
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					const url = String(input);
					calls.push(`${init?.method} ${url}`);
					if (url.endsWith("/createReply"))
						return Response.json({
							id: "outlook-draft",
							webLink:
								"https://outlook.office.com/mail/deeplink/read/outlook-draft",
						});
					expect(init?.method).toBe("PATCH");
					expect(JSON.parse(String(init?.body))).toEqual({
						subject: row.draftSubject,
						body: { contentType: "Text", content: row.draftBody },
						toRecipients: [
							{ emailAddress: { address: `${suffix}@contact.test` } },
						],
					});
					return new Response(null, { status: 204 });
				},
				{ preconnect: fetch.preconnect },
			),
		);
		restores.push(() => fetcher.mockRestore());
		try {
			const first = await service.openDraft(row.id, userId);
			expect(await service.openDraft(row.id, userId)).toEqual(first);
			expect(calls).toEqual([
				"POST https://graph.microsoft.com/v1.0/me/messages/outlook-original/createReply",
				"PATCH https://graph.microsoft.com/v1.0/me/messages/outlook-draft",
			]);
			expect(
				(await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).status,
			).toBe("APPROVED");
		} finally {
			await db.emailMessage.updateMany({
				where: { threadId },
				data: { gmailMessageId: "original-message", outlookMessageId: null },
			});
		}
	});

	it("encodes Unicode and rejects injected headers", () => {
		const input = {
			to: "person@example.test",
			subject: "Re: café",
			body: "Thanks — café",
			replyTo: "<original@example.test>",
			rootMessageId: "root@example.test",
			messageId: "<draft@crm.local>",
		};
		const raw = Buffer.from(gmailReplyRaw(input), "base64url").toString();
		expect(raw).toContain(
			`Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`,
		);
		expect(() =>
			gmailReplyRaw({
				...input,
				to: "person@example.test\r\nBcc: other@example.test",
			}),
		).toThrow("line break");
	});
});

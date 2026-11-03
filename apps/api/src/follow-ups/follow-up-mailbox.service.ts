import { GMAIL_DRAFT_SCOPE, OUTLOOK_DRAFT_SCOPE } from "@crm/auth/scopes";
import { type Db, FollowUpStatus } from "@crm/db";
import {
	followUpReplySubject,
	parseFollowUpSignal,
} from "@crm/validation/follow-up";
import {
	BadGatewayException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { MailboxTokenService } from "../mailbox/mailbox-token.service";
import { FOLLOW_UP_API } from "./follow-ups.config";

const gmailMessage = z.object({ threadId: z.string().min(1) });
const gmailDraft = z.object({
	id: z.string().min(1),
	message: z.object({ id: z.string().min(1) }),
});
const outlookDraft = z.object({
	id: z.string().min(1),
	webLink: z.string().url(),
});

export function gmailReplyRaw(input: {
	to: string;
	subject: string;
	body: string;
	replyTo: string;
	rootMessageId: string;
	messageId: string;
}) {
	for (const value of [
		input.to,
		input.subject,
		input.replyTo,
		input.rootMessageId,
		input.messageId,
	]) {
		if (/[\r\n]/.test(value))
			throw new ConflictException("Email headers contain a line break.");
	}
	const messageId = (value: string) => {
		const normalized = value.replace(/^</, "").replace(/>$/, "");
		if (!normalized || /[\s<>]/.test(normalized))
			throw new ConflictException("Email message IDs are invalid.");
		return `<${normalized}>`;
	};
	const parent = messageId(input.replyTo);
	const references = [
		...new Set([messageId(input.rootMessageId), parent]),
	].join(" ");
	const chunks: string[] = [];
	let chunk = "";
	for (const character of input.subject) {
		if (
			Buffer.byteLength(chunk + character) >
			FOLLOW_UP_API.email.subjectChunkBytes
		) {
			chunks.push(chunk);
			chunk = "";
		}
		chunk += character;
	}
	if (chunk) chunks.push(chunk);
	const subject = chunks
		.map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`)
		.join("\r\n ");
	const body =
		Buffer.from(input.body)
			.toString("base64")
			.match(/.{1,76}/g)
			?.join("\r\n") ?? "";
	return Buffer.from(
		[
			`To: ${input.to}`,
			`Subject: ${subject}`,
			`Message-ID: ${messageId(input.messageId)}`,
			`In-Reply-To: ${parent}`,
			`References: ${references}`,
			"MIME-Version: 1.0",
			'Content-Type: text/plain; charset="UTF-8"',
			"Content-Transfer-Encoding: base64",
			"",
			body,
		].join("\r\n"),
	).toString("base64url");
}

@Injectable()
export class FollowUpMailboxService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly tokens: MailboxTokenService,
	) {}

	async openDraft(
		id: string,
		userId: string,
	): Promise<{ url: string; provider: "gmail" | "outlook" }> {
		const row = await this.db.followUp.findUnique({
			where: { id },
			include: { contact: { select: { email: true } } },
		});
		if (!row) throw new NotFoundException("That follow-up no longer exists.");
		if (row.status !== FollowUpStatus.APPROVED || row.approvedById !== userId) {
			throw new ConflictException(
				"Approve this follow-up with your account before opening its mailbox draft.",
			);
		}
		if (!row.draftBody || !row.draftSubject || !row.contact.email) {
			throw new ConflictException(
				"This follow-up needs a recipient, subject, and message.",
			);
		}
		const user = await this.db.user.findUniqueOrThrow({
			where: { id: userId },
			select: { email: true },
		});
		if (row.mailboxDraftId && row.mailboxDraftUserId === userId) {
			if (row.mailboxDraftRecipient !== row.contact.email)
				throw new ConflictException(
					"The contact email changes. Review the existing draft recipient in your mailbox Drafts.",
				);
			if (row.mailboxDraftProvider === "gmail") {
				const token = await this.tokens.accessTokenFor(userId, "gmail");
				if (token.outcome !== "ok") throw new ConflictException(token.reason);
				const response = await fetch(
					`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(row.mailboxDraftId)}?format=metadata`,
					{
						headers: { authorization: `Bearer ${token.accessToken}` },
						signal: AbortSignal.timeout(FOLLOW_UP_API.email.requestTimeoutMs),
					},
				);
				if (!response.ok)
					throw new BadGatewayException(
						"The saved mailbox draft is unavailable. Check Gmail Drafts before creating another email.",
					);
				const draft = gmailDraft.parse(await response.json());
				await this.assertCurrent(id, userId, row.contact.email);
				return {
					url: this.draftUrl("gmail", draft.message.id, user.email),
					provider: "gmail",
				};
			}
			await this.assertCurrent(id, userId, row.contact.email);
			return {
				provider: "outlook",
				url: this.draftUrl(
					row.mailboxDraftProvider,
					row.mailboxDraftId,
					user.email,
				),
			};
		}
		if (row.mailboxDraftAttemptedAt) {
			throw new ConflictException(
				"The previous mailbox draft request has no saved result. Check your mailbox Drafts. Contact the administrator before retrying.",
			);
		}
		const signal = parseFollowUpSignal(row.signal);
		if (!signal.threadId)
			throw new ConflictException(
				"This follow-up has no synced email thread. Use the new email action.",
			);
		const message = await this.db.emailMessage.findFirst({
			include: { thread: { select: { rootMessageId: true } } },
			where: {
				threadId: signal.threadId,
				syncedByUserId: userId,
				OR: [
					{ fromEmail: { equals: row.contact.email, mode: "insensitive" } },
					{ direction: "OUTBOUND" },
				],
			},
			orderBy: { sentAt: "desc" },
		});
		if (!message)
			throw new ConflictException(
				"This thread is not synced from your mailbox. Connect and sync your mailbox first.",
			);
		const source = message.gmailMessageId
			? "gmail"
			: message.outlookMessageId
				? "outlook"
				: null;
		if (!source)
			throw new ConflictException(
				"This thread has no provider message. Use the new email action.",
			);
		const provider = source === "gmail" ? "google" : "microsoft";
		const scope = source === "gmail" ? GMAIL_DRAFT_SCOPE : OUTLOOK_DRAFT_SCOPE;
		if (!(await this.tokens.grantedScopes(userId, provider)).has(scope)) {
			throw new ConflictException(
				`Reconnect ${provider === "google" ? "Google" : "Microsoft"} to grant mailbox draft access.`,
			);
		}
		const token = await this.tokens.accessTokenFor(userId, source);
		if (token.outcome !== "ok") throw new ConflictException(token.reason);
		const request = async (
			url: string,
			method = "GET",
			body?:
				| { message: { threadId: string; raw: string } }
				| {
						subject: string;
						body: { contentType: "Text"; content: string };
						toRecipients: { emailAddress: { address: string } }[];
				  },
		) => {
			if (method === "POST") {
				const claimed = await this.db.followUp.updateMany({
					where: {
						id,
						status: FollowUpStatus.APPROVED,
						approvedById: userId,
						approvedAt: row.approvedAt,
						contact: { email: row.contact.email },
						draftSubject: row.draftSubject,
						draftBody: row.draftBody,
						mailboxDraftAttemptedAt: null,
					},
					data: { mailboxDraftAttemptedAt: new Date() },
				});
				if (claimed.count !== 1)
					throw new ConflictException(
						"This follow-up changes or its mailbox draft is already requested. Refresh the queue.",
					);
			}
			const response = await fetch(url, {
				method,
				headers: {
					authorization: `Bearer ${token.accessToken}`,
					"content-type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(FOLLOW_UP_API.email.requestTimeoutMs),
			});
			if (!response.ok)
				throw new BadGatewayException(
					`Mailbox draft request fails (${response.status}). No email is sent.`,
				);
			return response;
		};
		let draftId: string;
		let url: string;
		if (source === "gmail") {
			const base = "https://gmail.googleapis.com/gmail/v1/users/me";
			const original = gmailMessage.parse(
				await (
					await request(
						`${base}/messages/${encodeURIComponent(message.gmailMessageId ?? "")}?format=metadata`,
					)
				).json(),
			);
			const subject = signal.threadSubject ?? message.subject;
			if (
				!subject ||
				followUpReplySubject(row.draftSubject) !== followUpReplySubject(subject)
			) {
				throw new ConflictException(
					"Keep the original email subject to create a threaded Gmail reply.",
				);
			}
			const raw = gmailReplyRaw({
				to: row.contact.email,
				subject: followUpReplySubject(row.draftSubject),
				body: row.draftBody,
				replyTo: message.rfcMessageId,
				rootMessageId: message.thread.rootMessageId,
				messageId: `<follow-up-${row.id}@crm.local>`,
			});
			const draft = gmailDraft.parse(
				await (
					await request(`${base}/drafts`, "POST", {
						message: { threadId: original.threadId, raw },
					})
				).json(),
			);
			draftId = draft.id;
			url = this.draftUrl(source, draft.message.id, user.email);
		} else {
			const base = "https://graph.microsoft.com/v1.0/me/messages";
			const draft = outlookDraft.parse(
				await (
					await request(
						`${base}/${encodeURIComponent(message.outlookMessageId ?? "")}/createReply`,
						"POST",
					)
				).json(),
			);
			await request(`${base}/${encodeURIComponent(draft.id)}`, "PATCH", {
				subject: row.draftSubject,
				body: { contentType: "Text", content: row.draftBody },
				toRecipients: [{ emailAddress: { address: row.contact.email } }],
			});
			draftId = draft.webLink;
			url = this.draftUrl(source, draftId, user.email);
		}
		await this.db.followUp.update({
			where: { id },
			data: {
				mailboxDraftId: draftId,
				mailboxDraftProvider: source,
				mailboxDraftUserId: userId,
				mailboxDraftRecipient: row.contact.email,
			},
		});
		await this.assertCurrent(id, userId, row.contact.email);
		return { url, provider: source };
	}

	private async assertCurrent(id: string, userId: string, recipient: string) {
		const current = await this.db.followUp.findUnique({
			where: { id },
			select: {
				status: true,
				approvedById: true,
				contact: { select: { email: true } },
			},
		});
		if (
			!current ||
			current.status !== FollowUpStatus.APPROVED ||
			current.approvedById !== userId ||
			current.contact.email !== recipient
		) {
			throw new ConflictException(
				"The follow-up or recipient changes. The unsent draft remains in your mailbox Drafts. Review or delete it there.",
			);
		}
	}

	private draftUrl(provider: string | null, id: string, email: string): string {
		if (provider === "gmail")
			return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#drafts?compose=${encodeURIComponent(id)}`;
		const url = new URL(id);
		if (
			url.protocol !== "https:" ||
			![
				"outlook.office.com",
				"outlook.office365.com",
				"outlook.live.com",
			].includes(url.hostname)
		) {
			throw new BadGatewayException(
				"Microsoft returns an unsupported draft link.",
			);
		}
		return url.toString();
	}
}

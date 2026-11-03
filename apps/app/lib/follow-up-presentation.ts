import type { StatusTone } from "@crm/ui/components/status-indicator";
import type { RouterOutputs } from "@/lib/trpc/types";

export type FollowUpRow = RouterOutputs["followUps"]["list"]["rows"][number];

export type FollowUpSummary = RouterOutputs["followUps"]["summary"];

export type FollowUpKind = FollowUpRow["kind"];

export type FollowUpStatus = FollowUpRow["status"];

export type Mailbox = FollowUpSummary["mailbox"];

export type Dismissal = NonNullable<FollowUpRow["dismissal"]>;

export const FOLLOW_UP_KIND_LABEL = {
	UNANSWERED: "Unanswered",
	PROPOSAL: "Proposal",
	NO_REPLY: "No reply",
	STALLED_DEAL: "Stalled deal",
	DORMANT: "Gone quiet",
	NEVER_CONTACTED: "New lead",
} satisfies Record<FollowUpKind, string>;

export const FOLLOW_UP_STATUS = {
	OPEN: { label: "Needs a draft", tone: "neutral" },
	DRAFTING: { label: "Drafting", tone: "info" },
	READY: { label: "Draft ready", tone: "primary" },
	APPROVED: { label: "Approved, not sent", tone: "warning" },
	SENT: { label: "Sent", tone: "neutral" },
	REPLIED: { label: "Replied", tone: "success" },
	SNOOZED: { label: "Snoozed", tone: "neutral" },
	DISMISSED: { label: "Dismissed", tone: "neutral" },
	RESOLVED: { label: "Resolved", tone: "success" },
} satisfies Record<FollowUpStatus, { label: string; tone: StatusTone }>;

export const DISMISSAL_LABEL = {
	NOT_RELEVANT: "Not relevant",
	HANDLED: "Already handled",
	DO_NOT_CONTACT: "Do not contact again",
} satisfies Record<Dismissal, string>;

export const SNOOZE_DAYS = [3, 7, 14] as const;

export const FOLLOW_UP_POLL_MS = 4_000;

export const MAILBOX_LABEL = {
	gmail: "Gmail",
	outlook: "Outlook",
} satisfies Record<NonNullable<Mailbox>, string>;

export function composeUrl(
	mailbox: Mailbox,
	to: string,
	subject: string,
	body: string,
): string {
	const encode = encodeURIComponent;

	if (mailbox === "gmail") {
		return `https://mail.google.com/mail/?view=cm&fs=1&to=${encode(to)}&su=${encode(subject)}&body=${encode(body)}`;
	}

	if (mailbox === "outlook") {
		return `https://outlook.office.com/mail/deeplink/compose?to=${encode(to)}&subject=${encode(subject)}&body=${encode(body)}`;
	}

	return `mailto:${encode(to)}?subject=${encode(subject)}&body=${encode(body)}`;
}

export function personName(contact: FollowUpRow["contact"]): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

export function isPolling(rows: readonly FollowUpRow[]): boolean {
	return rows.some((row) => row.status === "DRAFTING");
}

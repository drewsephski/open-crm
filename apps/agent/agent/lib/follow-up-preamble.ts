import { db, type FollowUpKind } from "@crm/db";
import { parseFollowUpSignal } from "@crm/validation/follow-up";

const WHY = {
	UNANSWERED:
		"They wrote to us and nobody has replied. The draft answers what they actually asked, first, and apologises for the delay in one short clause at most.",
	PROPOSAL:
		"A proposal went out and the conversation stopped. The draft checks it arrived, offers to answer questions or walk through it, and suggests one concrete next step.",
	NO_REPLY:
		"Our last email got no answer. The draft is a short, polite nudge that adds one useful thing — a clarification, a simpler next step, or an easy way to say not now.",
	STALLED_DEAL:
		"An open deal has gone quiet. The draft restarts the conversation from where it actually stopped and asks one clear question about the next step.",
	DORMANT:
		"A past conversation went cold and there is no open deal. The draft is a genuine check-in that refers to what was discussed before. It does not pretend to be a first contact.",
	NEVER_CONTACTED:
		"This is a first email to someone imported from a list. Nothing has ever been exchanged. The draft introduces us honestly and briefly, says why we are writing to them specifically, and makes one low-pressure ask.",
} satisfies Record<FollowUpKind, string>;

export async function followUpPreamble(followUpId: string): Promise<{
	markdown: string;
	focus: { contactId?: string | null; companyId?: string | null };
} | null> {
	const followUp = await db.followUp.findUnique({
		where: { id: followUpId },
		select: {
			kind: true,
			reason: true,
			signal: true,
			contact: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					title: true,
					owner: { select: { name: true } },
				},
			},
			company: { select: { id: true, name: true, domain: true } },
			deal: {
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					currency: true,
					owner: { select: { name: true } },
				},
			},
		},
	});

	if (!followUp) return null;

	const signal = parseFollowUpSignal(followUp.signal);
	const { contact, company, deal } = followUp;
	const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

	const sender =
		deal?.owner.name ??
		contact.owner?.name ??
		(
			await db.member.findFirst({
				where: { role: "owner" },
				orderBy: { createdAt: "asc" },
				select: { user: { select: { name: true } } },
			})
		)?.user.name ??
		null;

	const lines = [
		"## This session: prepare one follow-up email",
		"",
		`**Follow-up \`${followUpId}\`.** ${followUp.reason}`,
		"",
		WHY[followUp.kind],
		"",
		`- **To:** ${name}${contact.title ? `, ${contact.title}` : ""} <${contact.email ?? "no address"}> — contact \`${contact.id}\``,
		company
			? `- **Company:** ${company.name}${company.domain ? ` (${company.domain})` : ""} — company \`${company.id}\``
			: "- **Company:** none on the record",
		deal
			? `- **Deal:** ${deal.name} — stage ${deal.stage}${deal.amount ? `, ${deal.amount.toString()} ${deal.currency}` : ""} — deal \`${deal.id}\``
			: "- **Deal:** none open",
		signal.threadSubject
			? `- **Latest thread:** “${signal.threadSubject}”`
			: "- **Latest thread:** none",
		`- **Quiet for:** ${signal.daysQuiet} days`,
		sender
			? `- **Signed by:** ${sender}. Sign off with their first name only.`
			: "- **Signed by:** unknown. End without a name; the rep adds it.",
		"",
		"### How to do it",
		"",
		`1. Call \`read_crm_history\` with contact \`${contact.id}\`${deal ? `, then \`read_deal_history\` with deal \`${deal.id}\`` : ""}. Read the real messages before writing a word.`,
		"2. Do not spend on outside lookups. Everything you need is in the CRM. If the history is thin, write a shorter email, not an invented one.",
		"3. Call `write_follow_up_draft` exactly once, then stop.",
		"",
		"### What a good draft is",
		"",
		"- Plain text, 40 to 120 words, written the way the sender writes in the thread.",
		"- Refers to something specific that was actually said or sent. Never invent a meeting, a promise, a price, a date or a detail.",
		"- One clear ask, easy to answer in one line.",
		"- No pressure tactics, no false urgency, no flattery, no “just circling back”, no “hope this finds you well”.",
		"- Never commit to a price, discount, deadline or deliverable that is not already in the thread.",
		"- If the history shows they asked us to stop, or that this follow-up would be inappropriate, still call the tool, but say so plainly in `note` and write the gentlest possible draft.",
		"- The subject continues the existing thread when there is one: reuse its subject with `Re: ` in front.",
	];

	return {
		markdown: lines.join("\n"),
		focus: { contactId: contact.id, companyId: company?.id ?? null },
	};
}

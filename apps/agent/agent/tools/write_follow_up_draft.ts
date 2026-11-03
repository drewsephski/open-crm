import { FOLLOW_UP_DRAFT_LIMITS } from "@crm/validation/follow-up";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { changeWrite } from "../lib/approval";
import { saveFollowUpDraft } from "../lib/follow-ups";
import { assertResearchPurpose, attribute } from "../lib/session-purpose";

export default defineTool({
	description:
		"Save the follow-up email you prepared, for a rep to review. Only works in a follow-up session. It never sends anything: a person reads, edits and approves it first.",
	inputSchema: z.object({
		subject: z
			.string()
			.trim()
			.min(1)
			.max(FOLLOW_UP_DRAFT_LIMITS.subject)
			.describe(
				"Reuse the existing thread's subject with 'Re: ' when there is one.",
			),
		body: z
			.string()
			.trim()
			.min(1)
			.max(FOLLOW_UP_DRAFT_LIMITS.body)
			.describe(
				"Plain text. Greeting, two to four short sentences, one clear ask, sign-off.",
			),
		note: z
			.string()
			.trim()
			.min(1)
			.max(FOLLOW_UP_DRAFT_LIMITS.note)
			.describe(
				"For the rep, one or two sentences: what in the history this draft rests on, and anything they should check before sending.",
			),
	}),
	approval: changeWrite(),
	async execute({ subject, body, note }, ctx) {
		assertResearchPurpose(ctx);

		const followUpId = attribute(ctx, "followUpId");
		if (!followUpId) {
			return {
				saved: false as const,
				reason:
					"This session is not preparing a follow-up, so there is nothing to save a draft against.",
			};
		}

		const saved = await saveFollowUpDraft(followUpId, ctx.session.id, {
			subject,
			body,
			note,
		});

		if (!saved) {
			return {
				saved: false as const,
				reason:
					"This follow-up was already handled, dismissed or resolved while you worked. Nothing was saved, and nothing more is needed.",
			};
		}

		return {
			saved: true as const,
			note: "Saved for review. A person approves it before anything is sent. Stop here.",
		};
	},
});

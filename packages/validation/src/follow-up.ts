import { DealStage, FollowUpKind } from "@crm/db/enums";
import { z } from "zod";

const isoDate = z.iso.datetime();

export const followUpSignal = z.object({
	evidence: z.enum(["email", "deal", "activity", "import"]),
	daysQuiet: z.number().int().min(0),
	lastInboundAt: isoDate.nullable(),
	lastOutboundAt: isoDate.nullable(),
	lastTouchAt: isoDate.nullable(),
	threadId: z.string().nullable(),
	threadSubject: z.string().nullable(),
	dealStage: z.enum(DealStage).nullable(),
});

export type FollowUpSignal = z.infer<typeof followUpSignal>;

export function parseFollowUpSignal(value: unknown): FollowUpSignal {
	const parsed = followUpSignal.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`A follow-up signal does not match its schema: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

export const followUpTaskPayload = z.object({
	followUpId: z.string().min(1),
	kind: z.enum(FollowUpKind),
});

export type FollowUpTaskPayload = z.infer<typeof followUpTaskPayload>;

export const FOLLOW_UP_DRAFT_LIMITS = {
	subject: 160,
	body: 4000,
	note: 600,
} as const;

export const followUpDraft = z.object({
	subject: z.string().trim().min(1).max(FOLLOW_UP_DRAFT_LIMITS.subject),
	body: z.string().trim().min(1).max(FOLLOW_UP_DRAFT_LIMITS.body),
});

export type FollowUpDraft = z.infer<typeof followUpDraft>;

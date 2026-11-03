import {
	DealStage,
	FollowUpDismissal,
	FollowUpKind,
	FollowUpStatus,
} from "@crm/db";
import { followUpDraft, followUpSignal } from "@crm/validation/follow-up";
import { z } from "zod";
import { FOLLOW_UP_API } from "./follow-ups.config";

export const FOLLOW_UP_VIEWS = ["todo", "sent", "closed"] as const;

export type FollowUpView = (typeof FOLLOW_UP_VIEWS)[number];

export const followUpListInput = z.object({
	view: z.enum(FOLLOW_UP_VIEWS).default("todo"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(FOLLOW_UP_API.list.maxLimit)
		.default(FOLLOW_UP_API.list.defaultLimit),
});

export type FollowUpListInput = z.infer<typeof followUpListInput>;

const personOutput = z.object({
	id: z.string(),
	firstName: z.string(),
	lastName: z.string().nullable(),
	email: z.string().nullable(),
	title: z.string().nullable(),
	imageUrl: z.string().nullable(),
});

const companyOutput = z.object({
	id: z.string(),
	name: z.string(),
	iconUrl: z.string().nullable(),
	iconDarkUrl: z.string().nullable(),
	iconTone: z.string().nullable(),
});

const dealOutput = z.object({
	id: z.string(),
	name: z.string(),
	stage: z.enum(DealStage),
	currency: z.string(),
	amountCents: z.number().nullable(),
	baseAmountCents: z.number().nullable(),
});

export const followUpRowOutput = z.object({
	id: z.string(),
	kind: z.enum(FollowUpKind),
	status: z.enum(FollowUpStatus),
	reason: z.string(),
	priority: z.number(),
	quietSince: z.string(),
	createdAt: z.string(),
	signal: followUpSignal,
	draft: z
		.object({
			subject: z.string(),
			body: z.string(),
			note: z.string().nullable(),
			draftedAt: z.string().nullable(),
			byAgent: z.boolean(),
		})
		.nullable(),
	draftError: z.string().nullable(),
	approvedAt: z.string().nullable(),
	approvedBy: z.string().nullable(),
	sentAt: z.string().nullable(),
	repliedAt: z.string().nullable(),
	snoozedUntil: z.string().nullable(),
	dismissal: z.enum(FollowUpDismissal).nullable(),
	resolution: z.string().nullable(),
	closedAt: z.string().nullable(),
	contact: personOutput,
	company: companyOutput.nullable(),
	deal: dealOutput.nullable(),
});

export type FollowUpRow = z.infer<typeof followUpRowOutput>;

export const followUpListOutput = z.object({
	rows: z.array(followUpRowOutput),
	total: z.number(),
});

const MAILBOX_PROVIDERS = ["gmail", "outlook"] as const;

export const followUpSummaryOutput = z.object({
	reportingCurrency: z.string(),
	todo: z.number(),
	ready: z.number(),
	drafting: z.number(),
	snoozed: z.number(),
	atRiskCents: z.number(),
	atRiskDeals: z.number(),
	windowDays: z.number(),
	sent: z.number(),
	replied: z.number(),
	replyRate: z.number().nullable(),
	won: z.object({ count: z.number(), valueCents: z.number() }),
	scannedAt: z.string().nullable(),
	scanError: z.string().nullable(),
	mailbox: z.enum(MAILBOX_PROVIDERS).nullable(),
	contacts: z.number(),
});

export type FollowUpSummary = z.infer<typeof followUpSummaryOutput>;

export const followUpIdInput = z.object({ id: z.string().min(1) });

export const followUpDraftInput = followUpIdInput.extend(followUpDraft.shape);

export type FollowUpDraftInput = z.infer<typeof followUpDraftInput>;

export const followUpDismissInput = followUpIdInput.extend({
	reason: z.enum(FollowUpDismissal),
});

export const followUpSnoozeInput = followUpIdInput.extend({
	days: z.number().int().min(1).max(FOLLOW_UP_API.snooze.maxDays),
});

export const followUpMutationOutput = z.object({
	id: z.string(),
	status: z.enum(FollowUpStatus),
});

export const followUpScanOutput = z.object({ requested: z.literal(true) });

export const followUpMailboxDraftOutput = z.object({ url: z.string().url() });

import { FollowUpStatus } from "./generated/prisma/enums";

export const ACTIVE_FOLLOW_UP_STATUSES = [
	FollowUpStatus.OPEN,
	FollowUpStatus.DRAFTING,
	FollowUpStatus.READY,
	FollowUpStatus.APPROVED,
	FollowUpStatus.SNOOZED,
] as const;

export const TO_DO_FOLLOW_UP_STATUSES = [
	FollowUpStatus.OPEN,
	FollowUpStatus.DRAFTING,
	FollowUpStatus.READY,
	FollowUpStatus.APPROVED,
] as const;

export const OUTREACH_FOLLOW_UP_STATUSES = [
	FollowUpStatus.SENT,
	FollowUpStatus.REPLIED,
] as const;

export const CLOSED_FOLLOW_UP_STATUSES = [
	FollowUpStatus.DISMISSED,
	FollowUpStatus.RESOLVED,
] as const;

const ACTIVE = new Set<FollowUpStatus>(ACTIVE_FOLLOW_UP_STATUSES);

export function isActiveFollowUp(status: FollowUpStatus): boolean {
	return ACTIVE.has(status);
}

export function followUpActiveKey(contactId: string): string {
	return `contact:${contactId}`;
}

export const FOLLOW_UP_DRAFT = {
	budget: 1,
} as const;

import { DealStage, FollowUpKind, RecordSource } from "@crm/db";
import type { FollowUpSignal } from "@crm/validation/follow-up";
import { FOLLOW_UPS } from "./follow-up-config";

const { DAY_MS } = FOLLOW_UPS.units;
const RULES = FOLLOW_UPS.rules;

export type OpenDealFacts = {
	id: string;
	name: string;
	stage: DealStage;
	stageChangedAt: Date;
	activityTouchAt: Date | null;
	reportingAmount: number | null;
};

export type ContactFacts = {
	contactId: string;
	companyId: string | null;
	firstName: string;
	source: RecordSource;
	createdAt: Date;
	lastInboundAt: Date | null;
	lastOutboundAt: Date | null;
	unansweredOutbound: number;
	activityTouchAt: Date | null;
	lastMeetingAt: Date | null;
	nextMeetingAt: Date | null;
	lastClosedAt: Date | null;
	thread: { id: string; subject: string | null } | null;
	deal: OpenDealFacts | null;
};

export type FollowUpCandidate = {
	contactId: string;
	companyId: string | null;
	dealId: string | null;
	kind: FollowUpKind;
	reason: string;
	priority: number;
	quietSince: Date;
	signal: FollowUpSignal;
};

const STAGE_LABEL = {
	DEMO_BOOKED: "Demo booked",
	QUALIFIED_TO_BUY: "Qualified",
	UNQUALIFIED_TO_BUY: "Unqualified",
	DECISION_MAKER_BOUGHT_IN: "Decision maker bought in",
	CONTRACT_SENT: "Proposal sent",
	CLOSED_WON: "Won",
	CLOSED_LOST: "Lost",
} satisfies Record<DealStage, string>;

function latest(...dates: (Date | null | undefined)[]): Date | null {
	let best: Date | null = null;
	for (const date of dates) {
		if (date && (!best || date.getTime() > best.getTime())) best = date;
	}
	return best;
}

function ageMs(now: Date, since: Date): number {
	return now.getTime() - since.getTime();
}

export function daysBetween(now: Date, since: Date): number {
	return Math.max(0, Math.floor(ageMs(now, since) / DAY_MS));
}

function ago(days: number): string {
	if (days === 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 14) return `${days} days ago`;
	if (days < 60) return `${Math.round(days / 7)} weeks ago`;
	return `${Math.round(days / 30)} months ago`;
}

function about(facts: ContactFacts): string {
	const subject = facts.thread?.subject?.trim();
	return subject ? ` about “${subject}”` : "";
}

export function valueBoost(amount: number | null): number {
	if (!amount || amount <= 0) return 0;
	return Math.min(
		FOLLOW_UPS.value.maxBoost,
		Math.round(Math.log10(1 + amount) * FOLLOW_UPS.value.boostPerDecade),
	);
}

function signalOf(
	facts: ContactFacts,
	evidence: FollowUpSignal["evidence"],
	quietSince: Date,
	now: Date,
	withDeal: boolean,
): FollowUpSignal {
	return {
		evidence,
		daysQuiet: daysBetween(now, quietSince),
		lastInboundAt: facts.lastInboundAt?.toISOString() ?? null,
		lastOutboundAt: facts.lastOutboundAt?.toISOString() ?? null,
		lastTouchAt: lastTouch(facts)?.toISOString() ?? null,
		threadId: facts.thread?.id ?? null,
		threadSubject: facts.thread?.subject ?? null,
		dealStage: withDeal && facts.deal ? facts.deal.stage : null,
	};
}

export function lastTouch(facts: ContactFacts): Date | null {
	return latest(
		facts.lastInboundAt,
		facts.lastOutboundAt,
		facts.activityTouchAt,
		facts.lastMeetingAt,
	);
}

function dealTouch(facts: ContactFacts, deal: OpenDealFacts): Date {
	return (
		latest(deal.stageChangedAt, deal.activityTouchAt, lastTouch(facts)) ??
		deal.stageChangedAt
	);
}

export function evaluate(
	facts: ContactFacts,
	now: Date,
): FollowUpCandidate | null {
	if (
		facts.nextMeetingAt &&
		facts.nextMeetingAt.getTime() > now.getTime() &&
		ageMs(facts.nextMeetingAt, now) <= RULES.meetingAheadMs
	) {
		return null;
	}

	const deal = facts.deal;
	const boost = valueBoost(deal?.reportingAmount ?? null);

	const base = {
		contactId: facts.contactId,
		companyId: facts.companyId,
	};

	const inbound = facts.lastInboundAt;
	const outbound = facts.lastOutboundAt;

	if (inbound && (!outbound || outbound.getTime() < inbound.getTime())) {
		const age = ageMs(now, inbound);
		if (age >= RULES.unanswered.afterMs && age <= RULES.unanswered.withinMs) {
			const days = daysBetween(now, inbound);
			return {
				...base,
				dealId: deal?.id ?? null,
				kind: FollowUpKind.UNANSWERED,
				reason: `${facts.firstName} emailed you ${ago(days)}${about(facts)} and has no reply.`,
				priority: RULES.unanswered.priority + boost,
				quietSince: inbound,
				signal: signalOf(facts, "email", inbound, now, true),
			};
		}
	}

	if (deal && deal.stage === DealStage.CONTRACT_SENT) {
		const since = dealTouch(facts, deal);
		if (ageMs(now, since) >= RULES.proposal.afterMs) {
			const days = daysBetween(now, since);
			return {
				...base,
				dealId: deal.id,
				kind: FollowUpKind.PROPOSAL,
				reason: `The proposal for “${deal.name}” has had no response for ${days} days.`,
				priority: RULES.proposal.priority + boost,
				quietSince: since,
				signal: signalOf(facts, "deal", since, now, true),
			};
		}
	}

	if (
		outbound &&
		(!inbound || inbound.getTime() < outbound.getTime()) &&
		facts.unansweredOutbound < RULES.noReply.maxUnanswered &&
		!(
			facts.lastClosedAt &&
			ageMs(now, facts.lastClosedAt) < RULES.noReply.quietAfterCloseMs
		)
	) {
		const age = ageMs(now, outbound);
		if (age >= RULES.noReply.afterMs && age <= RULES.noReply.withinMs) {
			const warm = Boolean(deal || inbound);
			const days = daysBetween(now, outbound);
			return {
				...base,
				dealId: deal?.id ?? null,
				kind: FollowUpKind.NO_REPLY,
				reason: `No reply to your email ${ago(days)}${about(facts)}.`,
				priority:
					(warm ? RULES.noReply.warmPriority : RULES.noReply.coldPriority) +
					boost,
				quietSince: outbound,
				signal: signalOf(facts, "email", outbound, now, true),
			};
		}
	}

	if (deal) {
		const since = dealTouch(facts, deal);
		if (ageMs(now, since) >= RULES.stalledDeal.afterMs) {
			const days = daysBetween(now, since);
			return {
				...base,
				dealId: deal.id,
				kind: FollowUpKind.STALLED_DEAL,
				reason: `“${deal.name}” has had no activity for ${days} days in ${STAGE_LABEL[deal.stage]}.`,
				priority: RULES.stalledDeal.priority + boost,
				quietSince: since,
				signal: signalOf(facts, "deal", since, now, true),
			};
		}
		return null;
	}

	const touched = lastTouch(facts);
	if (touched) {
		const spoke = Boolean(
			inbound || facts.activityTouchAt || facts.lastMeetingAt,
		);
		const age = ageMs(now, touched);
		if (
			spoke &&
			age >= RULES.dormant.afterMs &&
			age <= RULES.dormant.withinMs
		) {
			const days = daysBetween(now, touched);
			const evidence =
				facts.lastInboundAt || facts.lastOutboundAt ? "email" : "activity";
			return {
				...base,
				dealId: null,
				kind: FollowUpKind.DORMANT,
				reason: `Last contact was ${ago(days)}, and there is no open deal. Worth a check-in.`,
				priority: RULES.dormant.priority,
				quietSince: touched,
				signal: signalOf(facts, evidence, touched, now, false),
			};
		}
		return null;
	}

	if (facts.source === RecordSource.IMPORT) {
		const days = daysBetween(now, facts.createdAt);
		return {
			...base,
			dealId: null,
			kind: FollowUpKind.NEVER_CONTACTED,
			reason: `Imported ${ago(days)} and never contacted.`,
			priority: RULES.neverContacted.priority,
			quietSince: facts.createdAt,
			signal: signalOf(facts, "import", facts.createdAt, now, false),
		};
	}

	return null;
}

export type ActiveFollowUp = {
	id: string;
	kind: FollowUpKind;
	quietSince: Date;
	createdAt: Date;
	dealId: string | null;
	approvedAt: Date | null;
};

export type DealState = {
	stage: DealStage;
	stageChangedAt: Date;
	archivedAt: Date | null;
	activityTouchAt: Date | null;
};

export type Settlement =
	| { status: "keep" }
	| { status: "sent"; at: Date }
	| { status: "resolved"; resolution: string };

export function settlementOf(
	followUp: ActiveFollowUp & { status: string },
	facts: ContactFacts | null,
	deal: DealState | null,
): Settlement {
	if (!facts) {
		return { status: "resolved", resolution: "The contact was archived." };
	}

	const outbound = facts.lastOutboundAt;
	const inbound = facts.lastInboundAt;

	if (followUp.status === "APPROVED" && followUp.approvedAt) {
		if (outbound && outbound.getTime() >= followUp.approvedAt.getTime()) {
			return { status: "sent", at: outbound };
		}
		return { status: "keep" };
	}

	if (followUp.dealId) {
		if (!deal || deal.archivedAt) {
			return { status: "resolved", resolution: "The deal was archived." };
		}
		if (
			deal.stage === DealStage.CLOSED_WON ||
			deal.stage === DealStage.CLOSED_LOST ||
			deal.stage === DealStage.UNQUALIFIED_TO_BUY
		) {
			return {
				status: "resolved",
				resolution: `The deal closed as ${STAGE_LABEL[deal.stage]}.`,
			};
		}
		if (
			(followUp.kind === FollowUpKind.PROPOSAL ||
				followUp.kind === FollowUpKind.STALLED_DEAL) &&
			deal.stageChangedAt.getTime() > followUp.createdAt.getTime()
		) {
			return {
				status: "resolved",
				resolution: `The deal moved to ${STAGE_LABEL[deal.stage]}.`,
			};
		}
	}

	if (followUp.kind === FollowUpKind.UNANSWERED) {
		const answered =
			outbound && outbound.getTime() > followUp.quietSince.getTime();
		return answered
			? { status: "resolved", resolution: "You replied." }
			: { status: "keep" };
	}

	const since = followUp.quietSince.getTime();
	if (inbound && inbound.getTime() > since) {
		return { status: "resolved", resolution: "They got in touch." };
	}
	if (outbound && outbound.getTime() > since) {
		return {
			status: "resolved",
			resolution: "You followed up outside the queue.",
		};
	}
	const touched = latest(
		facts.activityTouchAt,
		facts.lastMeetingAt,
		followUp.dealId ? deal?.activityTouchAt : null,
	);
	if (touched && touched.getTime() > since) {
		return { status: "resolved", resolution: "New activity was logged." };
	}

	return { status: "keep" };
}

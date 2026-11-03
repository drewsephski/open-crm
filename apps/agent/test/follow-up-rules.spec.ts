import { describe, expect, it } from "bun:test";
import { DealStage, FollowUpKind, RecordSource } from "@crm/db";
import {
	type ContactFacts,
	evaluate,
	settlementOf,
	valueBoost,
} from "../agent/lib/follow-up-rules";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-03T12:00:00Z");

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY);
}

function facts(overrides: Partial<ContactFacts> = {}): ContactFacts {
	return {
		contactId: "c1",
		companyId: "co1",
		firstName: "Sarah",
		source: RecordSource.EMAIL,
		createdAt: daysAgo(200),
		lastInboundAt: null,
		lastOutboundAt: null,
		unansweredOutbound: 0,
		activityTouchAt: null,
		lastMeetingAt: null,
		nextMeetingAt: null,
		lastClosedAt: null,
		thread: { id: "t1", subject: "Website refresh quote" },
		deal: null,
		...overrides,
	};
}

function deal(stage: DealStage, quietDays: number) {
	return {
		id: "d1",
		name: "Acme rebrand",
		stage,
		stageChangedAt: daysAgo(quietDays),
		activityTouchAt: null,
		reportingAmount: 12_000,
	};
}

describe("evaluate", () => {
	it("flags an inbound email nobody answered", () => {
		const result = evaluate(facts({ lastInboundAt: daysAgo(3) }), NOW);
		expect(result?.kind).toBe(FollowUpKind.UNANSWERED);
		expect(result?.reason).toContain("Sarah emailed you 3 days ago");
		expect(result?.reason).toContain("Website refresh quote");
	});

	it("waits a day before calling an inbound email unanswered", () => {
		const result = evaluate(
			facts({ lastInboundAt: new Date(NOW.getTime() - 2 * 3_600_000) }),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("does not flag an inbound email we already answered", () => {
		const result = evaluate(
			facts({ lastInboundAt: daysAgo(3), lastOutboundAt: daysAgo(2) }),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("flags a quiet proposal before a quiet email", () => {
		const result = evaluate(
			facts({
				lastInboundAt: daysAgo(9),
				lastOutboundAt: daysAgo(8),
				deal: deal(DealStage.CONTRACT_SENT, 10),
			}),
			NOW,
		);
		expect(result?.kind).toBe(FollowUpKind.PROPOSAL);
		expect(result?.dealId).toBe("d1");
		expect(result?.reason).toContain("8 days");
	});

	it("ranks a warm no-reply above a cold one", () => {
		const warm = evaluate(
			facts({ lastInboundAt: daysAgo(20), lastOutboundAt: daysAgo(6) }),
			NOW,
		);
		const cold = evaluate(
			facts({ lastOutboundAt: daysAgo(6), unansweredOutbound: 1 }),
			NOW,
		);
		expect(warm?.kind).toBe(FollowUpKind.NO_REPLY);
		expect(cold?.kind).toBe(FollowUpKind.NO_REPLY);
		expect(warm?.priority ?? 0).toBeGreaterThan(cold?.priority ?? 0);
	});

	it("stops nudging after three unanswered emails", () => {
		const result = evaluate(
			facts({ lastOutboundAt: daysAgo(6), unansweredOutbound: 3 }),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("does not nudge right after a deal closed", () => {
		const result = evaluate(
			facts({
				lastInboundAt: daysAgo(12),
				lastOutboundAt: daysAgo(8),
				lastClosedAt: daysAgo(9),
			}),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("flags a stalled deal", () => {
		const result = evaluate(
			facts({ deal: deal(DealStage.QUALIFIED_TO_BUY, 20) }),
			NOW,
		);
		expect(result?.kind).toBe(FollowUpKind.STALLED_DEAL);
		expect(result?.reason).toContain("20 days in Qualified");
	});

	it("leaves an active deal alone", () => {
		const result = evaluate(
			facts({
				lastInboundAt: daysAgo(2),
				lastOutboundAt: daysAgo(1),
				deal: deal(DealStage.QUALIFIED_TO_BUY, 20),
			}),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("flags a dormant relationship with no open deal", () => {
		const result = evaluate(
			facts({ lastInboundAt: daysAgo(120), lastOutboundAt: daysAgo(100) }),
			NOW,
		);
		expect(result?.kind).toBe(FollowUpKind.DORMANT);
	});

	it("treats an imported last-contacted note as history", () => {
		const result = evaluate(
			facts({
				source: RecordSource.IMPORT,
				thread: null,
				activityTouchAt: daysAgo(90),
			}),
			NOW,
		);
		expect(result?.kind).toBe(FollowUpKind.DORMANT);
		expect(result?.signal.evidence).toBe("activity");
	});

	it("flags an imported lead nobody has contacted", () => {
		const result = evaluate(
			facts({
				source: RecordSource.IMPORT,
				thread: null,
				createdAt: daysAgo(2),
			}),
			NOW,
		);
		expect(result?.kind).toBe(FollowUpKind.NEVER_CONTACTED);
	});

	it("never flags a manual contact with no history", () => {
		expect(evaluate(facts({ thread: null }), NOW)).toBeNull();
	});

	it("stays quiet when a meeting is already booked", () => {
		const result = evaluate(
			facts({
				lastInboundAt: daysAgo(3),
				nextMeetingAt: new Date(NOW.getTime() + 2 * DAY),
			}),
			NOW,
		);
		expect(result).toBeNull();
	});

	it("boosts priority by deal value, with a ceiling", () => {
		expect(valueBoost(null)).toBe(0);
		expect(valueBoost(10_000)).toBeGreaterThan(valueBoost(1_000));
		expect(valueBoost(10 ** 12)).toBe(90);
	});
});

describe("settlementOf", () => {
	const base = {
		id: "f1",
		createdAt: daysAgo(2),
		dealId: null,
		approvedAt: null,
	};

	it("resolves an unanswered email once we reply", () => {
		const result = settlementOf(
			{
				...base,
				kind: FollowUpKind.UNANSWERED,
				status: "OPEN",
				quietSince: daysAgo(3),
			},
			facts({ lastInboundAt: daysAgo(3), lastOutboundAt: daysAgo(1) }),
			null,
		);
		expect(result).toEqual({ status: "resolved", resolution: "You replied." });
	});

	it("marks an approved follow-up sent when the mailbox shows it", () => {
		const sentAt = daysAgo(0.5);
		const result = settlementOf(
			{
				...base,
				kind: FollowUpKind.NO_REPLY,
				status: "APPROVED",
				quietSince: daysAgo(7),
				approvedAt: daysAgo(1),
			},
			facts({ lastOutboundAt: sentAt }),
			null,
		);
		expect(result).toEqual({ status: "sent", at: sentAt });
	});

	it("resolves a deal follow-up when the deal closes", () => {
		const result = settlementOf(
			{
				...base,
				kind: FollowUpKind.PROPOSAL,
				status: "READY",
				quietSince: daysAgo(6),
				dealId: "d1",
			},
			facts(),
			{
				stage: DealStage.CLOSED_WON,
				stageChangedAt: daysAgo(0),
				archivedAt: null,
				activityTouchAt: null,
			},
		);
		expect(result.status).toBe("resolved");
	});

	it("resolves when the contact is gone", () => {
		const result = settlementOf(
			{
				...base,
				kind: FollowUpKind.DORMANT,
				status: "OPEN",
				quietSince: daysAgo(90),
			},
			null,
			null,
		);
		expect(result.status).toBe("resolved");
	});

	it("keeps a follow-up nothing has touched", () => {
		const result = settlementOf(
			{
				...base,
				kind: FollowUpKind.NO_REPLY,
				status: "READY",
				quietSince: daysAgo(7),
			},
			facts({ lastOutboundAt: daysAgo(7) }),
			null,
		);
		expect(result).toEqual({ status: "keep" });
	});
});

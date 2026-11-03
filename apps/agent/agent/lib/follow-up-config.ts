const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const FOLLOW_UPS = {
	scan: {
		everyMs: 15 * MINUTE_MS,
		maxCreate: 200,
	},

	rules: {
		unanswered: { afterMs: 24 * HOUR_MS, withinMs: 30 * DAY_MS, priority: 900 },
		proposal: { afterMs: 3 * DAY_MS, priority: 800 },
		noReply: {
			afterMs: 5 * DAY_MS,
			withinMs: 45 * DAY_MS,
			warmPriority: 600,
			coldPriority: 300,
			maxUnanswered: 3,
			quietAfterCloseMs: 30 * DAY_MS,
		},
		stalledDeal: { afterMs: 14 * DAY_MS, priority: 500 },
		dormant: { afterMs: 60 * DAY_MS, withinMs: 730 * DAY_MS, priority: 200 },
		neverContacted: { maxOpen: 25, priority: 100 },
		meetingAheadMs: 14 * DAY_MS,
	},

	value: {
		maxBoost: 90,
		boostPerDecade: 15,
	},

	cooldown: {
		afterDismissMs: 30 * DAY_MS,
		afterResolvedMs: 2 * DAY_MS,
		afterOutreachMs: DAY_MS,
	},

	draft: {
		autoPerDay: 10,
		autoMinPriority: 200,
	},

	reply: {
		windowMs: 30 * DAY_MS,
	},

	units: { DAY_MS },
} as const;

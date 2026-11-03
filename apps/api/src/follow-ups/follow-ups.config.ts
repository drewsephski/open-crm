const DAY_MS = 24 * 60 * 60 * 1000;

export const FOLLOW_UP_API = {
	email: { requestTimeoutMs: 15_000, subjectChunkBytes: 45 },
	list: { defaultLimit: 100, maxLimit: 200 },
	snooze: { maxDays: 60 },
	summary: { windowDays: 30, wonWindowDays: 90 },
	units: { DAY_MS },
} as const;

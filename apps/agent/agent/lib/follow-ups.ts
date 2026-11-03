import {
	type DealStage,
	db,
	FollowUpDismissal,
	FollowUpKind,
	FollowUpStatus,
	Prisma,
	type RecordSource,
} from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import { OPEN_DEAL_STAGES } from "@crm/db/deal-stage";
import {
	ACTIVE_FOLLOW_UP_STATUSES,
	FOLLOW_UP_DRAFT,
	followUpActiveKey,
} from "@crm/db/follow-ups";
import {
	claimFollowUpScan,
	readReportingCurrency,
	stampFollowUpScan,
	writeFollowUpScanError,
} from "@crm/db/settings";
import type { FollowUpTaskPayload } from "@crm/validation/follow-up";
import { FOLLOW_UPS } from "./follow-up-config";
import {
	type ContactFacts,
	type DealState,
	evaluate,
	type FollowUpCandidate,
	type OpenDealFacts,
	settlementOf,
} from "./follow-up-rules";

export type FollowUpSweep = {
	ran: boolean;
	contacts: number;
	created: number;
	resolved: number;
	sent: number;
	replied: number;
	woken: number;
	draftsQueued: number;
	draftsFailed: number;
	error: string | null;
};

let lastSweep: FollowUpSweep | null = null;

export function followUpSweep(): FollowUpSweep | null {
	return lastSweep;
}

function emptySweep(): FollowUpSweep {
	return {
		ran: false,
		contacts: 0,
		created: 0,
		resolved: 0,
		sent: 0,
		replied: 0,
		woken: 0,
		draftsQueued: 0,
		draftsFailed: 0,
		error: null,
	};
}

export async function scanFollowUps(
	options: { now?: Date; force?: boolean } = {},
): Promise<FollowUpSweep> {
	const now = options.now ?? new Date();
	const sweep = emptySweep();

	try {
		if (options.force) {
			await stampFollowUpScan(db, now);
		} else if (!(await claimFollowUpScan(db, now, FOLLOW_UPS.scan.everyMs))) {
			return sweep;
		}

		sweep.ran = true;
		await runScan(sweep, now);
		await writeFollowUpScanError(db, null);
	} catch (cause) {
		sweep.error = cause instanceof Error ? cause.message : String(cause);
		console.error(`[agent] Follow-up scan failed: ${sweep.error}`);
		await writeFollowUpScanError(db, sweep.error).catch(() => {});
	}

	lastSweep = sweep;
	return sweep;
}

async function runScan(sweep: FollowUpSweep, now: Date): Promise<void> {
	const facts = await loadContactFacts(now);
	sweep.contacts = facts.size;

	await settleActive(sweep, facts, now);
	await trackReplies(sweep, now);
	await createCandidates(sweep, facts, now);
	await releaseFailedDrafts(sweep);
	await queueDrafts(sweep, now);
}

type ContactRow = {
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
	threadId: string | null;
	threadSubject: string | null;
};

type DealRow = {
	contactId: string;
	id: string;
	name: string;
	stage: DealStage;
	stageChangedAt: Date;
	baseAmount: Prisma.Decimal | null;
	baseCurrency: string | null;
	activityTouchAt: Date | null;
};

const HUMAN_ACTIVITY = Prisma.sql`a.type IN ('NOTE', 'CALL', 'MEETING')
	AND (a.meta IS NULL OR NOT (a.meta ? 'agent' OR a.meta ? 'agentId' OR a.meta ? 'undated'))`;

export async function loadContactFacts(
	now: Date,
	contactIds?: readonly string[],
): Promise<Map<string, ContactFacts>> {
	const only = contactIds
		? Prisma.sql`AND c.id = ANY(${[...contactIds]}::text[])`
		: Prisma.empty;

	const [contacts, deals, reporting] = await Promise.all([
		db.$queryRaw<ContactRow[]>`
			SELECT
				c.id AS "contactId",
				c."companyId",
				c."firstName",
				c.source,
				c."createdAt",
				m.last_in AS "lastInboundAt",
				m.last_out AS "lastOutboundAt",
				(
					SELECT count(*)::int
					FROM "emailMessage" em
					JOIN "emailThread" et ON et.id = em."threadId"
					WHERE et."contactId" = c.id
						AND em.direction = 'OUTBOUND'
						AND (m.last_in IS NULL OR em."sentAt" > m.last_in)
				) AS "unansweredOutbound",
				(
					SELECT max(COALESCE(a."occurredAt", a."createdAt"))
					FROM activity a
					WHERE a."contactId" = c.id
						AND COALESCE(a."occurredAt", a."createdAt") <= ${now}
						AND ${HUMAN_ACTIVITY}
				) AS "activityTouchAt",
				mt.last_meeting AS "lastMeetingAt",
				mt.next_meeting AS "nextMeetingAt",
				(
					SELECT max(d."closedAt")
					FROM "dealContact" dc
					JOIN deal d ON d.id = dc."dealId"
					WHERE dc."contactId" = c.id AND d."closedAt" IS NOT NULL
				) AS "lastClosedAt",
				th.id AS "threadId",
				th.subject AS "threadSubject"
			FROM contact c
			LEFT JOIN LATERAL (
				SELECT
					max(em."sentAt") FILTER (WHERE em.direction = 'INBOUND') AS last_in,
					max(em."sentAt") FILTER (WHERE em.direction = 'OUTBOUND') AS last_out
				FROM "emailMessage" em
				JOIN "emailThread" et ON et.id = em."threadId"
				WHERE et."contactId" = c.id
			) m ON true
			LEFT JOIN LATERAL (
				SELECT
					max(ev."startsAt") FILTER (WHERE ev."startsAt" <= ${now}) AS last_meeting,
					min(ev."startsAt") FILTER (WHERE ev."startsAt" > ${now}) AS next_meeting
				FROM "calendarAttendee" ca
				JOIN "calendarEvent" ev ON ev.id = ca."eventId"
				WHERE ca."contactId" = c.id AND ev.status <> 'cancelled'
			) mt ON true
			LEFT JOIN LATERAL (
				SELECT et.id, et.subject
				FROM "emailThread" et
				WHERE et."contactId" = c.id
				ORDER BY et."lastMessageAt" DESC
				LIMIT 1
			) th ON true
			WHERE c."archivedAt" IS NULL
				AND c.email IS NOT NULL
				${only}
		`,
		db.$queryRaw<DealRow[]>`
			WITH open_deals AS (
				SELECT
					d.id,
					d.name,
					d.stage,
					d."stageChangedAt",
					d."baseAmount",
					d."baseCurrency",
					d."companyId",
					(
						SELECT max(COALESCE(a."occurredAt", a."createdAt"))
						FROM activity a
						WHERE a."dealId" = d.id
							AND COALESCE(a."occurredAt", a."createdAt") <= ${now}
							AND ${HUMAN_ACTIVITY}
					) AS "activityTouchAt"
				FROM deal d
				WHERE d."archivedAt" IS NULL
					AND d.stage::text = ANY(${[...OPEN_DEAL_STAGES]}::text[])
			),
			people AS (
				SELECT dc."contactId", od.*
				FROM open_deals od
				JOIN "dealContact" dc ON dc."dealId" = od.id
				UNION ALL
				SELECT co."primaryContactId" AS "contactId", od.*
				FROM open_deals od
				JOIN company co ON co.id = od."companyId"
				WHERE co."primaryContactId" IS NOT NULL
					AND NOT EXISTS (
						SELECT 1 FROM "dealContact" dc WHERE dc."dealId" = od.id
					)
			)
			SELECT DISTINCT ON (p."contactId")
				p."contactId", p.id, p.name, p.stage, p."stageChangedAt",
				p."baseAmount", p."baseCurrency", p."activityTouchAt"
			FROM people p
			ORDER BY p."contactId", p."baseAmount" DESC NULLS LAST, p."stageChangedAt" ASC
		`,
		readReportingCurrency(db),
	]);

	const dealByContact = new Map<string, OpenDealFacts>();
	for (const row of deals) {
		dealByContact.set(row.contactId, {
			id: row.id,
			name: row.name,
			stage: row.stage,
			stageChangedAt: row.stageChangedAt,
			activityTouchAt: row.activityTouchAt,
			reportingAmount:
				row.baseAmount !== null && row.baseCurrency === reporting
					? Number(row.baseAmount)
					: null,
		});
	}

	const facts = new Map<string, ContactFacts>();
	for (const row of contacts) {
		facts.set(row.contactId, {
			contactId: row.contactId,
			companyId: row.companyId,
			firstName: row.firstName,
			source: row.source,
			createdAt: row.createdAt,
			lastInboundAt: row.lastInboundAt,
			lastOutboundAt: row.lastOutboundAt,
			unansweredOutbound: row.unansweredOutbound,
			activityTouchAt: row.activityTouchAt,
			lastMeetingAt: row.lastMeetingAt,
			nextMeetingAt: row.nextMeetingAt,
			lastClosedAt: row.lastClosedAt,
			thread: row.threadId
				? { id: row.threadId, subject: row.threadSubject }
				: null,
			deal: dealByContact.get(row.contactId) ?? null,
		});
	}

	return facts;
}

async function settleActive(
	sweep: FollowUpSweep,
	facts: Map<string, ContactFacts>,
	now: Date,
): Promise<void> {
	const active = await db.followUp.findMany({
		where: { status: { in: [...ACTIVE_FOLLOW_UP_STATUSES] } },
		select: {
			id: true,
			kind: true,
			status: true,
			contactId: true,
			dealId: true,
			quietSince: true,
			createdAt: true,
			approvedAt: true,
			snoozedUntil: true,
			draftedAt: true,
			deal: {
				select: { stage: true, stageChangedAt: true, archivedAt: true },
			},
		},
	});

	const dealTouches = await dealActivityTouches(
		active.flatMap((row) => (row.dealId ? [row.dealId] : [])),
		now,
	);

	for (const row of active) {
		const deal: DealState | null = row.deal
			? {
					...row.deal,
					activityTouchAt: row.dealId
						? (dealTouches.get(row.dealId) ?? null)
						: null,
				}
			: null;

		const outcome = settlementOf(
			row,
			facts.get(row.contactId) ?? null,
			row.dealId ? deal : null,
		);

		if (outcome.status === "sent") {
			const { count } = await db.followUp.updateMany({
				where: { id: row.id, status: FollowUpStatus.APPROVED },
				data: {
					status: FollowUpStatus.SENT,
					sentAt: outcome.at,
					activeKey: null,
				},
			});
			sweep.sent += count;
			continue;
		}

		if (outcome.status === "resolved") {
			const { count } = await db.followUp.updateMany({
				where: { id: row.id, status: row.status },
				data: {
					status: FollowUpStatus.RESOLVED,
					resolvedAt: now,
					resolution: outcome.resolution,
					activeKey: null,
				},
			});
			sweep.resolved += count;
			continue;
		}

		if (
			row.status === FollowUpStatus.SNOOZED &&
			row.snoozedUntil &&
			row.snoozedUntil.getTime() <= now.getTime()
		) {
			const { count } = await db.followUp.updateMany({
				where: { id: row.id, status: FollowUpStatus.SNOOZED },
				data: {
					status: row.draftedAt ? FollowUpStatus.READY : FollowUpStatus.OPEN,
					snoozedUntil: null,
				},
			});
			sweep.woken += count;
		}
	}
}

async function dealActivityTouches(
	dealIds: readonly string[],
	now: Date,
): Promise<Map<string, Date>> {
	if (dealIds.length === 0) return new Map();

	const rows = await db.$queryRaw<{ dealId: string; at: Date | null }[]>`
		SELECT a."dealId", max(COALESCE(a."occurredAt", a."createdAt")) AS at
		FROM activity a
		WHERE a."dealId" = ANY(${[...new Set(dealIds)]}::text[])
			AND COALESCE(a."occurredAt", a."createdAt") <= ${now}
			AND ${HUMAN_ACTIVITY}
		GROUP BY a."dealId"
	`;

	const touches = new Map<string, Date>();
	for (const row of rows) if (row.at) touches.set(row.dealId, row.at);
	return touches;
}

async function trackReplies(sweep: FollowUpSweep, now: Date): Promise<void> {
	const since = new Date(now.getTime() - FOLLOW_UPS.reply.windowMs);

	const replied = await db.$queryRaw<{ id: string; repliedAt: Date }[]>`
		SELECT f.id, min(em."sentAt") AS "repliedAt"
		FROM "followUp" f
		JOIN "emailThread" et ON et."contactId" = f."contactId"
		JOIN "emailMessage" em ON em."threadId" = et.id
		WHERE f.status = 'SENT'
			AND f."sentAt" >= ${since}
			AND em.direction = 'INBOUND'
			AND em."sentAt" > f."sentAt"
		GROUP BY f.id
	`;

	for (const row of replied) {
		const { count } = await db.followUp.updateMany({
			where: { id: row.id, status: FollowUpStatus.SENT },
			data: { status: FollowUpStatus.REPLIED, repliedAt: row.repliedAt },
		});
		sweep.replied += count;
	}
}

type History = {
	status: FollowUpStatus;
	dismissal: FollowUpDismissal | null;
	at: Date;
};

async function closedHistory(): Promise<{
	latest: Map<string, History>;
	blocked: Set<string>;
	active: Set<string>;
}> {
	const [rows, blockedRows, activeRows] = await Promise.all([
		db.$queryRaw<
			{
				contactId: string;
				status: FollowUpStatus;
				dismissal: FollowUpDismissal | null;
				at: Date;
			}[]
		>`
			SELECT DISTINCT ON (f."contactId")
				f."contactId",
				f.status,
				f.dismissal,
				COALESCE(f."dismissedAt", f."resolvedAt", f."repliedAt", f."sentAt", f."updatedAt") AS at
			FROM "followUp" f
			WHERE f."activeKey" IS NULL
			ORDER BY f."contactId", COALESCE(f."dismissedAt", f."resolvedAt", f."repliedAt", f."sentAt", f."updatedAt") DESC
		`,
		db.followUp.findMany({
			where: { dismissal: FollowUpDismissal.DO_NOT_CONTACT },
			select: { contactId: true },
			distinct: ["contactId"],
		}),
		db.followUp.findMany({
			where: { activeKey: { not: null } },
			select: { contactId: true },
		}),
	]);

	return {
		latest: new Map(rows.map((row) => [row.contactId, row])),
		blocked: new Set(blockedRows.map((row) => row.contactId)),
		active: new Set(activeRows.map((row) => row.contactId)),
	};
}

function coolingDown(history: History | undefined, now: Date): boolean {
	if (!history) return false;

	const wait =
		history.status === FollowUpStatus.DISMISSED
			? FOLLOW_UPS.cooldown.afterDismissMs
			: history.status === FollowUpStatus.RESOLVED
				? FOLLOW_UPS.cooldown.afterResolvedMs
				: FOLLOW_UPS.cooldown.afterOutreachMs;

	return now.getTime() - history.at.getTime() < wait;
}

export function chooseCandidates(
	facts: Iterable<ContactFacts>,
	now: Date,
	history: {
		latest: Map<string, History>;
		blocked: Set<string>;
		active: Set<string>;
	},
	neverContactedRoom: number,
	limit: number,
): FollowUpCandidate[] {
	const candidates: FollowUpCandidate[] = [];

	for (const contact of facts) {
		if (history.active.has(contact.contactId)) continue;
		if (history.blocked.has(contact.contactId)) continue;
		if (coolingDown(history.latest.get(contact.contactId), now)) continue;

		const candidate = evaluate(contact, now);
		if (candidate) candidates.push(candidate);
	}

	candidates.sort(
		(a, b) =>
			b.priority - a.priority ||
			a.quietSince.getTime() - b.quietSince.getTime(),
	);

	const chosen: FollowUpCandidate[] = [];
	let cold = 0;
	for (const candidate of candidates) {
		if (chosen.length >= limit) break;
		if (candidate.kind === FollowUpKind.NEVER_CONTACTED) {
			if (cold >= neverContactedRoom) continue;
			cold += 1;
		}
		chosen.push(candidate);
	}

	return chosen;
}

async function createCandidates(
	sweep: FollowUpSweep,
	facts: Map<string, ContactFacts>,
	now: Date,
): Promise<void> {
	const [history, openCold] = await Promise.all([
		closedHistory(),
		db.followUp.count({
			where: {
				kind: FollowUpKind.NEVER_CONTACTED,
				activeKey: { not: null },
			},
		}),
	]);

	const chosen = chooseCandidates(
		facts.values(),
		now,
		history,
		Math.max(0, FOLLOW_UPS.rules.neverContacted.maxOpen - openCold),
		FOLLOW_UPS.scan.maxCreate,
	);

	if (chosen.length === 0) return;

	const { count } = await db.followUp.createMany({
		data: chosen.map((candidate) => ({
			kind: candidate.kind,
			contactId: candidate.contactId,
			companyId: candidate.companyId,
			dealId: candidate.dealId,
			activeKey: followUpActiveKey(candidate.contactId),
			reason: candidate.reason,
			signal: candidate.signal,
			priority: candidate.priority,
			quietSince: candidate.quietSince,
		})),
		skipDuplicates: true,
	});

	sweep.created = count;
}

async function releaseFailedDrafts(sweep: FollowUpSweep): Promise<void> {
	const drafting = await db.followUp.findMany({
		where: {
			status: FollowUpStatus.DRAFTING,
			draftTaskId: { not: null },
		},
		select: { id: true, draftTaskId: true },
	});
	if (drafting.length === 0) return;

	const tasks = await db.agentTask.findMany({
		where: {
			id: { in: drafting.flatMap((row) => row.draftTaskId ?? []) },
			finishedAt: { not: null },
		},
		select: { id: true, outcome: true },
	});
	const finished = new Map(tasks.map((task) => [task.id, task.outcome]));

	for (const row of drafting) {
		if (!row.draftTaskId || !finished.has(row.draftTaskId)) continue;

		const { count } = await db.followUp.updateMany({
			where: { id: row.id, status: FollowUpStatus.DRAFTING },
			data: {
				status: FollowUpStatus.OPEN,
				draftError: draftFailure(finished.get(row.draftTaskId) ?? null),
			},
		});
		sweep.draftsFailed += count;
	}
}

const NO_DRAFT = "The agent finished without writing a draft.";

function draftFailure(outcome: string | null): string {
	return (outcome ? `${NO_DRAFT} ${outcome}` : NO_DRAFT).slice(0, 500);
}

function startOfDay(now: Date): Date {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}

async function queueDrafts(sweep: FollowUpSweep, now: Date): Promise<void> {
	const today = await db.agentTask.count({
		where: { kind: "follow-up", createdAt: { gte: startOfDay(now) } },
	});
	const room = FOLLOW_UPS.draft.autoPerDay - today;
	if (room <= 0) return;

	const open = await db.followUp.findMany({
		where: {
			status: FollowUpStatus.OPEN,
			draftTaskId: null,
			draftedAt: null,
			priority: { gte: FOLLOW_UPS.draft.autoMinPriority },
		},
		orderBy: [{ priority: "desc" }, { quietSince: "asc" }],
		take: room,
		select: {
			id: true,
			kind: true,
			contactId: true,
			companyId: true,
			dealId: true,
			reason: true,
		},
	});

	for (const row of open) {
		if (await queueDraft(row, now)) sweep.draftsQueued += 1;
	}
}

class Superseded extends Error {}

export async function queueDraft(
	row: {
		id: string;
		kind: FollowUpKind;
		contactId: string;
		companyId: string | null;
		dealId: string | null;
		reason: string;
	},
	now: Date = new Date(),
): Promise<boolean> {
	const payload: FollowUpTaskPayload = { followUpId: row.id, kind: row.kind };

	try {
		await db.$transaction(async (tx) => {
			const task = await tx.agentTask.create({
				data: {
					contactId: row.contactId,
					companyId: row.companyId,
					dealId: row.dealId,
					kind: "follow-up",
					reason: row.reason,
					payload,
					priority: PRIORITY.followUp,
					budget: FOLLOW_UP_DRAFT.budget,
					dueAt: now,
				},
				select: { id: true },
			});

			const { count } = await tx.followUp.updateMany({
				where: { id: row.id, status: FollowUpStatus.OPEN, draftTaskId: null },
				data: {
					status: FollowUpStatus.DRAFTING,
					draftTaskId: task.id,
					draftError: null,
				},
			});

			if (count === 0) throw new Superseded();
		});
		return true;
	} catch (error) {
		if (error instanceof Superseded) return false;
		throw error;
	}
}

export async function saveFollowUpDraft(
	followUpId: string,
	sessionId: string,
	draft: { subject: string; body: string; note: string },
): Promise<boolean> {
	const { count } = await db.followUp.updateMany({
		where: {
			id: followUpId,
			status: { in: [FollowUpStatus.OPEN, FollowUpStatus.DRAFTING] },
		},
		data: {
			draftSubject: draft.subject,
			draftBody: draft.body,
			draftNote: draft.note,
			draftedAt: new Date(),
			draftSessionId: sessionId,
			draftError: null,
			status: FollowUpStatus.READY,
		},
	});

	return count > 0;
}

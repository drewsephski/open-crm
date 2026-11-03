import {
	type Db,
	DealStage,
	type FollowUpDismissal,
	FollowUpStatus,
	type Prisma,
} from "@crm/db";
import {
	ACTIVE_FOLLOW_UP_STATUSES,
	CLOSED_FOLLOW_UP_STATUSES,
	OUTREACH_FOLLOW_UP_STATUSES,
	TO_DO_FOLLOW_UP_STATUSES,
} from "@crm/db/follow-ups";
import { readFollowUpScan } from "@crm/db/settings";
import { parseFollowUpSignal } from "@crm/validation/follow-up";
import {
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { toCents } from "../crm/values";
import { ConversionService } from "../currency/conversion.service";
import { InjectDatabase } from "../database/database.constants";
import { FOLLOW_UP_API } from "./follow-ups.config";
import type {
	FollowUpDraftInput,
	FollowUpListInput,
	FollowUpRow,
	FollowUpSummary,
	FollowUpView,
} from "./follow-ups.contracts";

const VIEW_STATUSES = {
	todo: TO_DO_FOLLOW_UP_STATUSES,
	sent: OUTREACH_FOLLOW_UP_STATUSES,
	closed: [...CLOSED_FOLLOW_UP_STATUSES, FollowUpStatus.SNOOZED],
} satisfies Record<FollowUpView, readonly FollowUpStatus[]>;

const ROW_SELECT = {
	id: true,
	kind: true,
	status: true,
	reason: true,
	priority: true,
	quietSince: true,
	createdAt: true,
	signal: true,
	draftSubject: true,
	draftBody: true,
	draftNote: true,
	draftedAt: true,
	draftSessionId: true,
	draftError: true,
	mailboxDraftAttemptedAt: true,
	approvedAt: true,
	approvedBy: { select: { name: true } },
	sentAt: true,
	repliedAt: true,
	snoozedUntil: true,
	dismissal: true,
	dismissedAt: true,
	resolution: true,
	resolvedAt: true,
	contact: {
		select: {
			id: true,
			firstName: true,
			lastName: true,
			email: true,
			title: true,
			imageUrl: true,
		},
	},
	company: {
		select: {
			id: true,
			name: true,
			iconUrl: true,
			iconDarkUrl: true,
			iconTone: true,
		},
	},
	deal: {
		select: {
			id: true,
			name: true,
			stage: true,
			currency: true,
			amount: true,
			baseAmount: true,
			baseCurrency: true,
		},
	},
} as const satisfies Prisma.FollowUpSelect;

type RowRecord = Prisma.FollowUpGetPayload<{ select: typeof ROW_SELECT }>;

const APPROVABLE = [
	FollowUpStatus.OPEN,
	FollowUpStatus.DRAFTING,
	FollowUpStatus.READY,
	FollowUpStatus.SNOOZED,
] as const;

const EDITABLE = [...APPROVABLE, FollowUpStatus.APPROVED] as const;

const SNOOZABLE = [
	FollowUpStatus.OPEN,
	FollowUpStatus.DRAFTING,
	FollowUpStatus.READY,
	FollowUpStatus.APPROVED,
] as const;

const DRAFTABLE = [FollowUpStatus.OPEN, FollowUpStatus.READY] as const;

@Injectable()
export class FollowUpsService {
	private readonly logger = new Logger(FollowUpsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly conversion: ConversionService,
		private readonly agent: AgentTriggerService,
	) {}

	async list(input: FollowUpListInput) {
		const where: Prisma.FollowUpWhereInput = {
			status: { in: [...VIEW_STATUSES[input.view]] },
		};

		const orderBy: Prisma.FollowUpOrderByWithRelationInput[] =
			input.view === "todo"
				? [{ priority: "desc" }, { quietSince: "asc" }]
				: input.view === "sent"
					? [{ sentAt: "desc" }]
					: [{ updatedAt: "desc" }];

		const [rows, total, base] = await Promise.all([
			this.db.followUp.findMany({
				where,
				orderBy,
				take: input.limit,
				select: ROW_SELECT,
			}),
			this.db.followUp.count({ where }),
			this.conversion.reportingCurrency(),
		]);

		return { rows: rows.map((row) => this.toRow(row, base)), total };
	}

	async summary(userId: string): Promise<FollowUpSummary> {
		const now = Date.now();
		const { DAY_MS } = FOLLOW_UP_API.units;
		const since = new Date(now - FOLLOW_UP_API.summary.windowDays * DAY_MS);
		const wonSince = new Date(
			now - FOLLOW_UP_API.summary.wonWindowDays * DAY_MS,
		);

		const base = await this.conversion.reportingCurrency();

		const [byStatus, atRisk, sent, replied, won, scan, mailbox, contacts] =
			await Promise.all([
				this.db.followUp.groupBy({
					by: ["status"],
					where: { status: { in: [...ACTIVE_FOLLOW_UP_STATUSES] } },
					_count: { _all: true },
				}),
				this.db.deal.aggregate({
					where: {
						AND: [
							{
								archivedAt: null,
								followUps: {
									some: { status: { in: [...TO_DO_FOLLOW_UP_STATUSES] } },
								},
							},
							this.conversion.countedWhere(base),
						],
					},
					_count: { _all: true },
					_sum: { baseAmount: true },
				}),
				this.db.followUp.count({ where: { sentAt: { gte: since } } }),
				this.db.followUp.count({
					where: { sentAt: { gte: since }, repliedAt: { not: null } },
				}),
				this.db.deal.aggregate({
					where: {
						AND: [
							{
								stage: DealStage.CLOSED_WON,
								closedAt: { gte: wonSince },
								followUps: { some: { sentAt: { not: null } } },
							},
							this.conversion.countedWhere(base),
						],
					},
					_count: { _all: true },
					_sum: { baseAmount: true },
				}),
				readFollowUpScan(this.db),
				this.db.mailboxSync.findFirst({
					where: { userId, source: { in: ["gmail", "outlook"] } },
					orderBy: { updatedAt: "desc" },
					select: { source: true },
				}),
				this.db.contact.count({ where: { archivedAt: null } }),
			]);

		const count = (status: FollowUpStatus) =>
			byStatus.find((row) => row.status === status)?._count._all ?? 0;

		return {
			reportingCurrency: base,
			todo: TO_DO_FOLLOW_UP_STATUSES.reduce(
				(total, status) => total + count(status),
				0,
			),
			ready: count(FollowUpStatus.READY),
			drafting: count(FollowUpStatus.DRAFTING),
			snoozed: count(FollowUpStatus.SNOOZED),
			atRiskCents: toCents(atRisk._sum.baseAmount) ?? 0,
			atRiskDeals: atRisk._count._all,
			windowDays: FOLLOW_UP_API.summary.windowDays,
			sent,
			replied,
			replyRate: sent === 0 ? null : replied / sent,
			won: {
				count: won._count._all,
				valueCents: toCents(won._sum.baseAmount) ?? 0,
			},
			scannedAt: scan.scannedAt?.toISOString() ?? null,
			scanError: scan.error,
			mailbox:
				mailbox?.source === "gmail" || mailbox?.source === "outlook"
					? mailbox.source
					: null,
			contacts,
		};
	}

	async saveDraft(input: FollowUpDraftInput, userId: string) {
		return this.transition(
			input.id,
			APPROVABLE,
			{
				draftSubject: input.subject,
				draftBody: input.body,
				editedBy: { connect: { id: userId } },
			},
			(current) =>
				current === FollowUpStatus.OPEN || current === FollowUpStatus.DRAFTING
					? FollowUpStatus.READY
					: current,
			(current) => {
				if (current.mailboxDraftAttemptedAt)
					throw new ConflictException(
						"A mailbox draft is saved or pending. Edit it in your mailbox.",
					);
			},
		);
	}

	async approve(input: FollowUpDraftInput, userId: string) {
		const result = await this.transition(
			input.id,
			APPROVABLE,
			{
				draftSubject: input.subject,
				draftBody: input.body,
				approvedBy: { connect: { id: userId } },
				approvedAt: new Date(),
				snoozedUntil: null,
			},
			() => FollowUpStatus.APPROVED,
			(current) => {
				if (
					current.mailboxDraftAttemptedAt &&
					(current.draftSubject !== input.subject ||
						current.draftBody !== input.body ||
						current.approvedById !== userId)
				) {
					throw new ConflictException(
						"A mailbox draft is saved or pending. Keep the approved text and approver. Edit it in your mailbox.",
					);
				}
			},
		);

		this.logger.log({
			message: "Follow-up approved",
			followUpId: input.id,
			userId,
		});
		return result;
	}

	async markSent(id: string, userId: string) {
		const existing = await this.find(id);
		const now = new Date();

		const result = await this.transition(
			id,
			EDITABLE,
			{
				sentAt: now,
				approvedAt: existing.approvedAt ?? now,
				approvedBy: existing.approvedById
					? undefined
					: { connect: { id: userId } },
				activeKey: null,
				snoozedUntil: null,
			},
			() => FollowUpStatus.SENT,
		);

		this.logger.log({ message: "Follow-up sent", followUpId: id, userId });
		return result;
	}

	async dismiss(id: string, reason: FollowUpDismissal, userId: string) {
		const result = await this.transition(
			id,
			ACTIVE_FOLLOW_UP_STATUSES,
			{
				dismissal: reason,
				dismissedAt: new Date(),
				dismissedBy: { connect: { id: userId } },
				activeKey: null,
				snoozedUntil: null,
			},
			() => FollowUpStatus.DISMISSED,
		);

		this.logger.log({
			message: "Follow-up dismissed",
			followUpId: id,
			reason,
			userId,
		});
		return result;
	}

	async snooze(id: string, days: number) {
		return this.transition(
			id,
			SNOOZABLE,
			{
				snoozedUntil: new Date(Date.now() + days * FOLLOW_UP_API.units.DAY_MS),
			},
			() => FollowUpStatus.SNOOZED,
		);
	}

	async requestDraft(id: string) {
		const followUp = await this.find(id);
		if (followUp.mailboxDraftAttemptedAt) {
			throw new ConflictException(
				"This follow-up has a mailbox draft request. Keep the approved text and edit the message in your mailbox.",
			);
		}

		if (!(DRAFTABLE as readonly FollowUpStatus[]).includes(followUp.status)) {
			throw new ConflictException(
				"This follow-up is not waiting for a draft any more.",
			);
		}

		const queued = await this.agent.followUpDraftRequested(followUp);
		if (!queued) {
			throw new ConflictException(
				"This follow-up changed while the draft was being requested. Refresh and try again.",
			);
		}

		return { id, status: FollowUpStatus.DRAFTING };
	}

	async scanNow() {
		await this.agent.followUpScanRequested();
		return { requested: true as const };
	}

	private async find(id: string) {
		const row = await this.db.followUp.findUnique({
			where: { id },
			select: {
				id: true,
				kind: true,
				status: true,
				contactId: true,
				companyId: true,
				dealId: true,
				reason: true,
				approvedAt: true,
				approvedById: true,
				mailboxDraftAttemptedAt: true,
				draftSubject: true,
				draftBody: true,
			},
		});
		if (!row) throw new NotFoundException("That follow-up no longer exists.");
		return row;
	}

	private async transition(
		id: string,
		from: readonly FollowUpStatus[],
		data: Prisma.FollowUpUpdateInput,
		next: (current: FollowUpStatus) => FollowUpStatus,
		validate?: (current: Awaited<ReturnType<FollowUpsService["find"]>>) => void,
	) {
		const current = await this.find(id);

		if (!from.includes(current.status)) {
			throw new ConflictException(
				"This follow-up has already been handled. Refresh to see where it is.",
			);
		}

		validate?.(current);
		const status = next(current.status);

		const updated = await this.db.$transaction(async (tx) => {
			const { count } = await tx.followUp.updateMany({
				where: {
					id,
					status: current.status,
					mailboxDraftAttemptedAt: current.mailboxDraftAttemptedAt,
				},
				data: { status },
			});
			if (count === 0) return null;
			return tx.followUp.update({
				where: { id },
				data,
				select: { id: true, status: true },
			});
		});

		if (!updated) {
			throw new ConflictException(
				"This follow-up changed while you were working on it. Refresh and try again.",
			);
		}

		return updated;
	}

	private toRow(row: RowRecord, base: string): FollowUpRow {
		const draft =
			row.draftSubject && row.draftBody
				? {
						subject: row.draftSubject,
						body: row.draftBody,
						note: row.draftNote,
						draftedAt: row.draftedAt?.toISOString() ?? null,
						byAgent: Boolean(row.draftSessionId),
					}
				: null;

		return {
			id: row.id,
			kind: row.kind,
			status: row.status,
			reason: row.reason,
			priority: row.priority,
			quietSince: row.quietSince.toISOString(),
			createdAt: row.createdAt.toISOString(),
			signal: parseFollowUpSignal(row.signal),
			draft,
			draftError: row.draftError,
			mailboxDraftLocked: row.mailboxDraftAttemptedAt !== null,
			approvedAt: row.approvedAt?.toISOString() ?? null,
			approvedBy: row.approvedBy?.name ?? null,
			sentAt: row.sentAt?.toISOString() ?? null,
			repliedAt: row.repliedAt?.toISOString() ?? null,
			snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
			dismissal: row.dismissal,
			resolution: row.resolution,
			closedAt: (row.dismissedAt ?? row.resolvedAt)?.toISOString() ?? null,
			contact: row.contact,
			company: row.company,
			deal: row.deal
				? {
						id: row.deal.id,
						name: row.deal.name,
						stage: row.deal.stage,
						currency: row.deal.currency,
						amountCents: toCents(row.deal.amount),
						baseAmountCents:
							row.deal.baseCurrency === base
								? toCents(row.deal.baseAmount)
								: null,
					}
				: null,
		};
	}
}

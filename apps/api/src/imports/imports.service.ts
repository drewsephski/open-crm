import {
	type Db,
	type DealStage,
	EnrichmentStatus,
	Prisma,
	RecordSource,
} from "@crm/db";
import { isCurrencyCode, normalizeCurrency } from "@crm/db/currency";
import { isClosedStage } from "@crm/db/deal-stage";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import { blankToNull, normalizeEmail } from "../crm/values";
import { ConversionService } from "../currency/conversion.service";
import { InjectDatabase } from "../database/database.constants";
import { IMPORTS } from "./imports.config";
import type { ImportInput, ImportOutput, ImportRow } from "./imports.contracts";

const AMOUNT_SUFFIX = { k: 1_000, m: 1_000_000 } as const;

export type SplitName = { firstName: string; lastName: string | null };

export function stageFromText(value: string | undefined): DealStage | null {
	const text = value?.trim().toLowerCase();
	if (!text) return null;

	for (const entry of IMPORTS.stageWords) {
		if (entry.words.some((word) => text === word)) return entry.stage;
	}
	for (const entry of IMPORTS.stageWords) {
		if (entry.words.some((word) => text.includes(word))) return entry.stage;
	}
	return null;
}

export function amountFromText(value: string | undefined): number | null {
	const text = value?.trim().toLowerCase().replace(/[\s,]/g, "");
	if (!text) return null;

	const match = /^[^\d-]*(\d+(?:\.\d+)?)([km])?/.exec(text);
	if (!match?.[1]) return null;

	const suffix = match[2];
	const unit = suffix === "k" || suffix === "m" ? AMOUNT_SUFFIX[suffix] : 1;
	const amount = Number(match[1]) * unit;
	return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function dateFromText(
	value: string | undefined,
	now: Date,
): Date | null {
	const text = value?.trim();
	if (!text) return null;

	const date = new Date(text);
	if (Number.isNaN(date.getTime())) return null;
	if (date.getTime() > now.getTime()) return null;
	if (date.getFullYear() < 1990) return null;
	return date;
}

export function splitName(row: ImportRow, email: string): SplitName {
	const first = row.firstName?.trim();
	if (first)
		return { firstName: first, lastName: blankToNull(row.lastName ?? "") };

	const parts = row.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
	if (parts.length > 0) {
		return {
			firstName: parts[0] ?? "",
			lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
		};
	}

	const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
	return {
		firstName: local ? local.charAt(0).toUpperCase() + local.slice(1) : email,
		lastName: null,
	};
}

type RowResult = {
	contactCreated: boolean;
	contactUpdated: boolean;
	companyCreated: string | null;
	contactId: string;
	dealCreated: boolean;
	historyNotes: number;
};

@Injectable()
export class ImportsService {
	private readonly logger = new Logger(ImportsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly conversion: ConversionService,
		private readonly agent: AgentTriggerService,
	) {}

	async contacts(input: ImportInput, userId: string): Promise<ImportOutput> {
		const output: ImportOutput = {
			contactsCreated: 0,
			contactsUpdated: 0,
			companiesCreated: 0,
			dealsCreated: 0,
			historyNotes: 0,
			skipped: [],
		};

		const reporting = await this.conversion.reportingCurrency();
		const researchCompanies: string[] = [];
		const researchContacts: string[] = [];

		for (const [index, row] of input.rows.entries()) {
			const line = input.firstRow + index;
			const email = normalizeEmail(row.email ?? "");

			if (!email || !email.includes("@")) {
				output.skipped.push({
					row: line,
					reason: "No email address. Follow-ups need one.",
				});
				continue;
			}

			try {
				const result = await this.importRow(row, email, userId, reporting);
				if (result.contactCreated) output.contactsCreated += 1;
				if (result.contactUpdated) output.contactsUpdated += 1;
				if (result.companyCreated) {
					output.companiesCreated += 1;
					researchCompanies.push(result.companyCreated);
				}
				if (result.contactCreated) researchContacts.push(result.contactId);
				if (result.dealCreated) output.dealsCreated += 1;
				output.historyNotes += result.historyNotes;
			} catch (error) {
				this.logger.error(
					{ message: "Import row failed", row: line },
					error instanceof Error ? error.stack : String(error),
				);
				output.skipped.push({
					row: line,
					reason:
						error instanceof Prisma.PrismaClientKnownRequestError &&
						error.code === "P2002"
							? "Another row in this import already used this email or domain."
							: "This row could not be saved.",
				});
			}
		}

		if (input.research) {
			for (const id of researchCompanies) {
				await this.agent.companyCreated(id, "Imported from a spreadsheet");
			}
			for (const id of researchContacts) {
				await this.agent.contactCreated(id, "Imported from a spreadsheet");
			}
		}

		this.logger.log({
			message: "Import batch finished",
			firstRow: input.firstRow,
			rows: input.rows.length,
			contactsCreated: output.contactsCreated,
			contactsUpdated: output.contactsUpdated,
			companiesCreated: output.companiesCreated,
			dealsCreated: output.dealsCreated,
			skipped: output.skipped.length,
			research: input.research,
		});

		await this.agent.followUpScanRequested();

		return output;
	}

	private async importRow(
		row: ImportRow,
		email: string,
		userId: string,
		reporting: string,
	): Promise<RowResult> {
		const now = new Date();
		const lastContactedAt = dateFromText(row.lastContactedAt, now);
		const stage = stageFromText(row.dealStage);
		const amount = amountFromText(row.dealAmount);
		const currency = isCurrencyCode(row.dealCurrency)
			? normalizeCurrency(row.dealCurrency)
			: reporting;
		const fx = await this.conversion.dealFields(
			amount === null ? null : new Prisma.Decimal(amount),
			currency,
		);
		const wantsDeal = Boolean(row.dealName?.trim() || stage || amount);
		const enrichmentStatus = EnrichmentStatus.SKIPPED;

		return this.db.$transaction(async (tx) => {
			const result: RowResult = {
				contactCreated: false,
				contactUpdated: false,
				companyCreated: null,
				contactId: "",
				dealCreated: false,
				historyNotes: 0,
			};

			const domain =
				normalizeDomain(row.website) ?? domainFromEmail(email) ?? null;
			const companyName = row.companyName?.trim() || domain;

			let companyId: string | null = null;
			if (companyName) {
				const existing = domain
					? await tx.company.findFirst({
							where: { domain, archivedAt: null },
							select: { id: true },
						})
					: await tx.company.findFirst({
							where: {
								name: { equals: companyName, mode: "insensitive" },
								archivedAt: null,
							},
							select: { id: true },
						});

				if (existing) {
					companyId = existing.id;
				} else {
					const created = await tx.company.create({
						data: {
							name: companyName,
							domain,
							website: domain ? `https://${domain}` : null,
							ownerId: userId,
							source: RecordSource.IMPORT,
							enrichmentStatus,
						},
						select: { id: true },
					});
					companyId = created.id;
					result.companyCreated = created.id;
				}
			}

			const name = splitName(row, email);
			const existing = await tx.contact.findFirst({
				where: {
					email: { equals: email, mode: "insensitive" },
					archivedAt: null,
				},
				select: {
					id: true,
					lastName: true,
					phone: true,
					title: true,
					companyId: true,
				},
			});

			let contactId: string;
			if (existing) {
				contactId = existing.id;
				const fill: Prisma.ContactUpdateInput = {};
				if (!existing.lastName && name.lastName) fill.lastName = name.lastName;
				if (!existing.phone && row.phone?.trim()) fill.phone = row.phone.trim();
				if (!existing.title && row.title?.trim()) fill.title = row.title.trim();
				if (!existing.companyId && companyId) {
					fill.company = { connect: { id: companyId } };
				}
				if (Object.keys(fill).length > 0) {
					await tx.contact.update({ where: { id: contactId }, data: fill });
					result.contactUpdated = true;
				}
			} else {
				await tx.suppressedContact.deleteMany({ where: { email } });
				const created = await tx.contact.create({
					data: {
						firstName: name.firstName,
						lastName: name.lastName,
						email,
						phone: blankToNull(row.phone ?? ""),
						title: blankToNull(row.title ?? ""),
						companyId,
						ownerId: userId,
						source: RecordSource.IMPORT,
						enrichmentStatus,
					},
					select: { id: true },
				});
				contactId = created.id;
				result.contactCreated = true;
			}
			result.contactId = contactId;

			let dealId: string | null = null;
			if (wantsDeal && companyId) {
				const dealName =
					row.dealName?.trim() ||
					`${companyName ?? name.firstName} opportunity`;
				const duplicate = await tx.deal.findFirst({
					where: {
						companyId,
						archivedAt: null,
						name: { equals: dealName, mode: "insensitive" },
					},
					select: { id: true },
				});

				if (duplicate) {
					dealId = duplicate.id;
				} else {
					const dealStage = stage ?? "DEMO_BOOKED";
					const changedAt = lastContactedAt ?? now;
					const deal = await tx.deal.create({
						data: {
							name: dealName,
							companyId,
							ownerId: userId,
							stage: dealStage,
							stageChangedAt: changedAt,
							closedAt: isClosedStage(dealStage) ? changedAt : null,
							amount: amount === null ? null : new Prisma.Decimal(amount),
							currency,
							...fx,
						},
						select: { id: true },
					});
					dealId = deal.id;
					result.dealCreated = true;
				}

				await tx.dealContact.upsert({
					where: { dealId_contactId: { dealId, contactId } },
					create: { dealId, contactId },
					update: {},
				});
			}

			if (lastContactedAt) {
				await tx.activity.create({
					data: {
						type: "NOTE",
						subject: IMPORTS.note.lastContactedSubject,
						body: row.notes?.trim() || null,
						occurredAt: lastContactedAt,
						contactId,
						companyId,
						dealId,
						createdById: userId,
						meta: { imported: true },
					},
				});
				await tx.contact.updateMany({
					where: {
						id: contactId,
						OR: [
							{ lastActivityAt: null },
							{ lastActivityAt: { lt: lastContactedAt } },
						],
					},
					data: { lastActivityAt: lastContactedAt },
				});
				result.historyNotes += 1;
			} else if (row.notes?.trim()) {
				await tx.activity.create({
					data: {
						type: "NOTE",
						subject: IMPORTS.note.notesSubject,
						body: row.notes.trim(),
						contactId,
						companyId,
						dealId,
						createdById: userId,
						meta: { imported: true, undated: true },
					},
				});
				result.historyNotes += 1;
			}

			return result;
		});
	}
}

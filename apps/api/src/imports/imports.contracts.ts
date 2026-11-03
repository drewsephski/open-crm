import { z } from "zod";
import { IMPORTS } from "./imports.config";

const text = (max: number) => z.string().trim().max(max).optional();

export const importRow = z.object({
	firstName: text(IMPORTS.field.short),
	lastName: text(IMPORTS.field.short),
	fullName: text(IMPORTS.field.short),
	email: text(IMPORTS.field.email),
	phone: text(IMPORTS.field.short),
	title: text(IMPORTS.field.short),
	companyName: text(IMPORTS.field.short),
	website: text(IMPORTS.field.short),
	dealName: text(IMPORTS.field.short),
	dealStage: text(IMPORTS.field.short),
	dealAmount: text(IMPORTS.field.short),
	dealCurrency: text(IMPORTS.field.short),
	lastContactedAt: text(IMPORTS.field.short),
	notes: text(IMPORTS.field.notes),
});

export type ImportRow = z.infer<typeof importRow>;

export const importInput = z.object({
	rows: z.array(importRow).min(1).max(IMPORTS.batch.maxRows),
	firstRow: z.number().int().min(1).default(1),
	research: z.boolean().default(false),
});

export type ImportInput = z.infer<typeof importInput>;

export const importOutput = z.object({
	contactsCreated: z.number(),
	contactsUpdated: z.number(),
	companiesCreated: z.number(),
	dealsCreated: z.number(),
	historyNotes: z.number(),
	skipped: z.array(z.object({ row: z.number(), reason: z.string() })),
});

export type ImportOutput = z.infer<typeof importOutput>;

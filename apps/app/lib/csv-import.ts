export const IMPORT_FIELDS = [
	{
		key: "email",
		label: "Email",
		synonyms: ["email", "e-mail", "email address", "work email", "mail"],
	},
	{
		key: "firstName",
		label: "First name",
		synonyms: ["first name", "firstname", "first", "given name"],
	},
	{
		key: "lastName",
		label: "Last name",
		synonyms: ["last name", "lastname", "last", "surname", "family name"],
	},
	{
		key: "fullName",
		label: "Full name",
		synonyms: ["name", "full name", "contact", "contact name", "person"],
	},
	{
		key: "title",
		label: "Job title",
		synonyms: ["title", "job title", "role", "position"],
	},
	{
		key: "phone",
		label: "Phone",
		synonyms: ["phone", "phone number", "mobile", "telephone", "cell"],
	},
	{
		key: "companyName",
		label: "Company",
		synonyms: [
			"company",
			"company name",
			"organization",
			"organisation",
			"account",
			"business",
		],
	},
	{
		key: "website",
		label: "Website",
		synonyms: ["website", "domain", "url", "company website", "web"],
	},
	{
		key: "dealName",
		label: "Deal name",
		synonyms: ["deal", "deal name", "opportunity", "project"],
	},
	{
		key: "dealStage",
		label: "Deal stage",
		synonyms: [
			"stage",
			"deal stage",
			"status",
			"pipeline stage",
			"lead status",
		],
	},
	{
		key: "dealAmount",
		label: "Deal value",
		synonyms: [
			"amount",
			"value",
			"deal value",
			"deal amount",
			"price",
			"budget",
			"quote",
		],
	},
	{
		key: "dealCurrency",
		label: "Currency",
		synonyms: ["currency"],
	},
	{
		key: "lastContactedAt",
		label: "Last contacted",
		synonyms: [
			"last contacted",
			"last contact",
			"last contact date",
			"last activity",
			"last activity date",
			"last touch",
			"last email",
		],
	},
	{
		key: "notes",
		label: "Notes",
		synonyms: ["notes", "note", "comments", "description"],
	},
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export type ImportMapping = Record<ImportFieldKey, number | null>;

export type ImportRowInput = Partial<Record<ImportFieldKey, string>>;

export const IMPORT_BATCH_SIZE = 250;

export const MAX_IMPORT_ROWS = 10_000;

export function parseCsv(text: string): string[][] {
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];

		if (quoted) {
			if (char === '"') {
				if (source[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && source[index + 1] === "\n") index += 1;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}

	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replace(/-/g, "")
		.replace(/[_.]+/g, " ")
		.replace(/\s+/g, " ");
}

export function guessMapping(headers: readonly string[]): ImportMapping {
	const normalized = headers.map(normalizeHeader);
	const taken = new Set<number>();
	const mapping = Object.fromEntries(
		IMPORT_FIELDS.map((field) => [field.key, null]),
	) as ImportMapping;

	for (const field of IMPORT_FIELDS) {
		const index = normalized.findIndex(
			(header, position) =>
				!taken.has(position) &&
				(field.synonyms as readonly string[]).includes(header),
		);
		if (index >= 0) {
			mapping[field.key] = index;
			taken.add(index);
		}
	}

	return mapping;
}

export function mapRows(
	rows: readonly string[][],
	mapping: ImportMapping,
): ImportRowInput[] {
	return rows.map((cells) => {
		const row: ImportRowInput = {};
		for (const field of IMPORT_FIELDS) {
			const index = mapping[field.key];
			if (index === null) continue;
			const value = cells[index]?.trim();
			if (value) row[field.key] = value;
		}
		return row;
	});
}

export function batches<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		out.push(items.slice(start, start + size));
	}
	return out;
}

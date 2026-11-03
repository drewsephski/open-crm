"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { formatCount } from "@crm/ui/lib/format";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	batches,
	guessMapping,
	IMPORT_BATCH_SIZE,
	IMPORT_FIELDS,
	type ImportFieldKey,
	type ImportMapping,
	MAX_IMPORT_ROWS,
	mapRows,
	parseCsv,
} from "@/lib/csv-import";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

const SKIP = "skip";

type Parsed = {
	fileName: string;
	headers: string[];
	rows: string[][];
};

type Totals = {
	contactsCreated: number;
	contactsUpdated: number;
	companiesCreated: number;
	dealsCreated: number;
	historyNotes: number;
	skipped: { row: number; reason: string }[];
};

const EMPTY_TOTALS: Totals = {
	contactsCreated: 0,
	contactsUpdated: 0,
	companiesCreated: 0,
	dealsCreated: 0,
	historyNotes: 0,
	skipped: [],
};

export function CsvImport() {
	const [parsed, setParsed] = useState<Parsed | null>(null);
	const [mapping, setMapping] = useState<ImportMapping | null>(null);
	const fileId = useId();

	const read = async (file: File) => {
		const rows = parseCsv(await file.text());
		const [headers, ...body] = rows;
		if (!headers || body.length === 0) {
			toast.error("That file has no rows under its header.");
			return;
		}
		if (body.length > MAX_IMPORT_ROWS) {
			toast.error(
				`That file has ${body.length} rows. Split it into files of ${MAX_IMPORT_ROWS} or fewer.`,
			);
			return;
		}
		setParsed({ fileName: file.name, headers, rows: body });
		setMapping(guessMapping(headers));
	};

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>1. Choose a CSV file</CardTitle>
					<CardDescription>
						Export from a spreadsheet, HubSpot, Pipedrive, Jobber or anything
						else. One row per person. An email column is required.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Field>
						<FieldLabel htmlFor={fileId}>File</FieldLabel>
						<Input
							id={fileId}
							type="file"
							accept=".csv,text/csv"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file) void read(file);
							}}
						/>
						<FieldDescription>
							Add a “Last contacted” column if you have one. It is how the CRM
							spots relationships that have gone quiet without your mailbox
							history.
						</FieldDescription>
					</Field>
				</CardContent>
			</Card>

			{parsed && mapping ? (
				<MappingStep
					key={parsed.fileName}
					parsed={parsed}
					mapping={mapping}
					onMappingChange={setMapping}
				/>
			) : null}
		</>
	);
}

function MappingStep({
	parsed,
	mapping,
	onMappingChange,
}: {
	parsed: Parsed;
	mapping: ImportMapping;
	onMappingChange: (mapping: ImportMapping) => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const workspaceUrl = useWorkspaceUrl();
	const researchId = useId();

	const [research, setResearch] = useState(false);
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
	} | null>(null);
	const [totals, setTotals] = useState<Totals | null>(null);

	const importBatch = useMutation(trpc.imports.contacts.mutationOptions());

	const rows = mapRows(parsed.rows, mapping);
	const withEmail = rows.filter((row) => row.email?.includes("@")).length;
	const hasName =
		mapping.firstName !== null ||
		mapping.fullName !== null ||
		mapping.email !== null;

	const run = async () => {
		const chunks = batches(rows, IMPORT_BATCH_SIZE);
		let sum: Totals = { ...EMPTY_TOTALS, skipped: [] };
		setTotals(null);
		setProgress({ done: 0, total: rows.length });

		try {
			for (const [index, chunk] of chunks.entries()) {
				const result = await importBatch.mutateAsync({
					rows: chunk,
					firstRow: index * IMPORT_BATCH_SIZE + 2,
					research,
				});
				sum = {
					contactsCreated: sum.contactsCreated + result.contactsCreated,
					contactsUpdated: sum.contactsUpdated + result.contactsUpdated,
					companiesCreated: sum.companiesCreated + result.companiesCreated,
					dealsCreated: sum.dealsCreated + result.dealsCreated,
					historyNotes: sum.historyNotes + result.historyNotes,
					skipped: [...sum.skipped, ...result.skipped],
				};
				setProgress({
					done: Math.min(rows.length, (index + 1) * IMPORT_BATCH_SIZE),
					total: rows.length,
				});
			}
			toast.success("Import finished. Follow-ups are being checked now.");
		} catch (error) {
			toast.error(
				error instanceof Error
					? `The import stopped part-way: ${error.message}. Rows before it were saved; running the file again is safe.`
					: "The import stopped part-way. Running the file again is safe.",
			);
		} finally {
			setTotals(sum);
			setProgress(null);
			await cache.everything();
		}
	};

	const setColumn = (key: ImportFieldKey, value: string) =>
		onMappingChange({
			...mapping,
			[key]: value === SKIP ? null : Number(value),
		});

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>2. Check the columns</CardTitle>
					<CardDescription>
						{parsed.fileName}: {formatCount(parsed.rows.length, "row")},{" "}
						{withEmail} with an email address. Columns were matched by name;
						change any that are wrong.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						{IMPORT_FIELDS.map((field) => {
							const selected = mapping[field.key];
							const sample =
								selected === null
									? null
									: parsed.rows.find((row) => row[selected]?.trim())?.[
											selected
										];
							return (
								<Field key={field.key} orientation="horizontal">
									<FieldLabel htmlFor={`map-${field.key}`} className="w-32">
										{field.label}
									</FieldLabel>
									<Select
										value={selected === null ? SKIP : String(selected)}
										onValueChange={(value) => setColumn(field.key, value)}
									>
										<SelectTrigger id={`map-${field.key}`} className="w-56">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={SKIP}>Not imported</SelectItem>
											{parsed.headers.map((header, index) => (
												<SelectItem
													key={`${header}-${index.toString()}`}
													value={String(index)}
												>
													{header || `Column ${index + 1}`}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FieldDescription className="truncate">
										{sample ?? ""}
									</FieldDescription>
								</Field>
							);
						})}
					</FieldGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>3. Import</CardTitle>
					<CardDescription>
						New people and companies are marked as imported. Existing people
						keep what they have; only blank fields are filled.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field orientation="horizontal">
							<Checkbox
								id={researchId}
								checked={research}
								onCheckedChange={(checked) => setResearch(checked === true)}
							/>
							<FieldLabel htmlFor={researchId}>
								Let the agent research new companies and people. This uses
								research credits for every new record.
							</FieldLabel>
						</Field>

						{mapping.email === null ? (
							<Alert variant="warning">
								<AlertTitle>Choose the email column</AlertTitle>
								<AlertDescription>
									Rows without an email address are skipped, because there is
									nobody to follow up with.
								</AlertDescription>
							</Alert>
						) : null}

						<div className="flex items-center gap-3">
							<Button
								disabled={
									progress !== null || mapping.email === null || !hasName
								}
								onClick={() => void run()}
							>
								{progress ? <Spinner data-icon="inline-start" /> : null}
								{progress
									? `Importing ${progress.done} of ${progress.total}`
									: `Import ${formatCount(withEmail, "person", "people")}`}
							</Button>
						</div>
					</FieldGroup>
				</CardContent>
			</Card>

			{totals ? (
				<Card>
					<CardHeader>
						<CardTitle>Result</CardTitle>
						<CardDescription>
							{formatCount(totals.contactsCreated, "person", "people")} added ·{" "}
							{totals.contactsUpdated} updated ·{" "}
							{formatCount(totals.companiesCreated, "company", "companies")} ·{" "}
							{formatCount(totals.dealsCreated, "deal")} ·{" "}
							{formatCount(totals.historyNotes, "history note")} ·{" "}
							{totals.skipped.length} skipped
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-3">
							{totals.skipped.length > 0 ? (
								<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-muted-foreground text-xs">
									{totals.skipped.map((entry) => (
										<li key={entry.row}>
											Row {entry.row}: {entry.reason}
										</li>
									))}
								</ul>
							) : null}
							<div>
								<Button asChild>
									<Link href={workspaceUrl("/follow-ups")}>
										See who needs a follow-up
									</Link>
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			) : null}
		</>
	);
}

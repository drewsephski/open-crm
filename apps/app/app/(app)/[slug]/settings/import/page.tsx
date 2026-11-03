import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { CsvImport } from "./csv-import";

export const metadata: Metadata = {
	title: "Import",
};

export default function ImportSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Import</PageShellTitle>
					<PageShellDescription>
						Bring in customers and prospects from a spreadsheet or another CRM.
						Re-importing the same file updates people rather than duplicating
						them.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Importer />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Importer() {
	await requireSession();

	return (
		<div className="flex max-w-3xl flex-col gap-6">
			<CsvImport />
		</div>
	);
}

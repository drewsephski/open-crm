"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { formatCount, formatMoneyCompact } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FOLLOW_UP_KIND_LABEL,
	FOLLOW_UP_STATUS,
	personName,
} from "@/lib/follow-up-presentation";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

const PREVIEW = 5;

const CELL = "px-3 py-2.5 align-middle";

const COLUMNS: SimpleTableColumn[] = [
	{ id: "person", header: "Person", width: "w-48" },
	{ id: "why", header: "Why now" },
	{
		id: "status",
		header: "Status",
		width: "w-36",
		className: "hidden sm:table-cell",
	},
];

export function FollowUpsCallout() {
	const trpc = useTRPC();
	const router = useRouter();
	const workspaceUrl = useWorkspaceUrl();

	const summary = useQuery(trpc.followUps.summary.queryOptions());
	const list = useQuery(trpc.followUps.list.queryOptions({ view: "todo" }));

	if (!summary.data || !list.data) return null;

	const rows = list.data.rows.slice(0, PREVIEW);
	const { todo, atRiskCents, reportingCurrency } = summary.data;

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Waiting on you</CardTitle>
				<CardDescription>
					{todo === 0
						? "Nobody is waiting on a reply or a follow-up"
						: `${formatCount(todo, "follow-up")} due${atRiskCents > 0 ? ` · ${formatMoneyCompact(atRiskCents, reportingCurrency)} of open pipeline` : ""}`}
				</CardDescription>
				<CardAction>
					<Button asChild variant="contrast" size="sm">
						<Link href={workspaceUrl("/follow-ups")}>Open follow-ups</Link>
					</Button>
				</CardAction>
			</CardHeader>
			<CardPanel>
				{rows.length === 0 ? (
					<CardPanelEmpty>
						Nothing to chase. New ones appear the moment a conversation goes
						quiet.
					</CardPanelEmpty>
				) : (
					<SimpleTable variant="panel" surface="page" columns={COLUMNS}>
						{rows.map((row) => {
							const status = FOLLOW_UP_STATUS[row.status];
							return (
								<SimpleTableRow
									key={row.id}
									clickable
									onClick={() =>
										router.push(
											workspaceUrl(
												`/follow-ups?${SEARCH_PARAM.followUps.open}=${row.id}`,
											),
										)
									}
								>
									<TableCell className={CELL}>
										<span className="flex min-w-0 flex-col">
											<span className="truncate font-medium">
												{personName(row.contact)}
											</span>
											<span className="truncate text-muted-foreground">
												{row.company?.name ?? FOLLOW_UP_KIND_LABEL[row.kind]}
											</span>
										</span>
									</TableCell>
									<TableCell className={CELL}>
										<span className="line-clamp-2 whitespace-normal text-pretty">
											{row.reason}
										</span>
									</TableCell>
									<TableCell className={`${CELL} hidden sm:table-cell`}>
										<StatusIndicator tone={status.tone} label={status.label} />
									</TableCell>
								</SimpleTableRow>
							);
						})}
					</SimpleTable>
				)}
			</CardPanel>
		</Card>
	);
}

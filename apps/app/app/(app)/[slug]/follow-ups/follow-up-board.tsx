"use client";

import { Button } from "@crm/ui/components/button";
import { Card } from "@crm/ui/components/card";
import { CardTableEmpty } from "@crm/ui/components/card-table";
import { StatGroup } from "@crm/ui/components/dashboard";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { StatCard } from "@crm/ui/components/stat-card";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import {
	formatCount,
	formatMoneyCompact,
	formatPercent,
} from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { LocalRelativeTime } from "@/components/local-date-time";
import {
	FOLLOW_UP_KIND_LABEL,
	FOLLOW_UP_POLL_MS,
	FOLLOW_UP_STATUS,
	type FollowUpRow,
	type FollowUpSummary,
	isPolling,
	personName,
} from "@/lib/follow-up-presentation";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { FollowUpReviewSheet } from "./follow-up-review-sheet";
import { type FollowUpView, followUpParsers } from "./follow-ups-search-params";

const CELL = "px-3 py-2.5 align-middle";

const COLUMNS: SimpleTableColumn[] = [
	{ id: "person", header: "Person", width: "w-56" },
	{ id: "why", header: "Why now" },
	{
		id: "value",
		header: "Deal",
		width: "w-24",
		align: "right",
		className: "hidden md:table-cell",
	},
	{
		id: "status",
		header: "Status",
		width: "w-40",
		className: "hidden sm:table-cell",
	},
	{
		id: "when",
		header: "Quiet since",
		width: "w-28",
		align: "right",
		className: "hidden lg:table-cell",
	},
];

const EMPTY_COPY = {
	todo: "Nothing is waiting on you. New follow-ups appear here as soon as a conversation goes quiet.",
	sent: "Nothing sent from here yet. Approved follow-ups show up here once they go out.",
	closed: "Nothing dismissed, snoozed or resolved yet.",
} satisfies Record<FollowUpView, string>;

export function FollowUpBoard() {
	const trpc = useTRPC();

	const [view] = useQueryState(
		SEARCH_PARAM.followUps.view,
		followUpParsers[SEARCH_PARAM.followUps.view],
	);
	const [openId, setOpenId] = useQueryState(
		SEARCH_PARAM.followUps.open,
		followUpParsers[SEARCH_PARAM.followUps.open],
	);

	const summary = useQuery({
		...trpc.followUps.summary.queryOptions(),
		refetchInterval: (query) =>
			query.state.data && query.state.data.drafting > 0
				? FOLLOW_UP_POLL_MS
				: false,
	});

	const list = useQuery({
		...trpc.followUps.list.queryOptions({ view }),
		placeholderData: (previous) => previous,
		refetchInterval: (query) =>
			query.state.data && isPolling(query.state.data.rows)
				? FOLLOW_UP_POLL_MS
				: false,
	});

	if (!summary.data || !list.data) {
		return (
			<div className="flex flex-1 justify-center py-12">
				<Spinner />
			</div>
		);
	}

	const rows = list.data.rows;
	const open = rows.find((row) => row.id === openId) ?? null;

	return (
		<div className="flex flex-col gap-6">
			<FollowUpStats summary={summary.data} />

			<ScanLine summary={summary.data} />

			<Card className="min-w-0">
				{rows.length === 0 ? (
					summary.data.contacts === 0 && view === "todo" ? (
						<GettingStarted />
					) : (
						<CardTableEmpty>{EMPTY_COPY[view]}</CardTableEmpty>
					)
				) : (
					<SimpleTable columns={COLUMNS}>
						{rows.map((row) => (
							<FollowUpTableRow
								key={row.id}
								row={row}
								reportingCurrency={summary.data.reportingCurrency}
								onOpen={() => void setOpenId(row.id)}
							/>
						))}
					</SimpleTable>
				)}
			</Card>

			<FollowUpReviewSheet
				row={open}
				mailbox={summary.data.mailbox}
				onClose={() => void setOpenId(null)}
			/>
		</div>
	);
}

function FollowUpStats({ summary }: { summary: FollowUpSummary }) {
	const money = (cents: number) =>
		formatMoneyCompact(cents, summary.reportingCurrency);

	return (
		<StatGroup>
			<StatCard
				label="Needs attention"
				value={summary.todo}
				description={`${formatCount(summary.ready, "draft")} ready · ${summary.drafting} drafting`}
			/>
			<StatCard
				label="Pipeline waiting on you"
				value={money(summary.atRiskCents)}
				description={
					summary.atRiskDeals === 0
						? "No open deal is waiting on a follow-up"
						: `${formatCount(summary.atRiskDeals, "open deal")} with a follow-up due`
				}
			/>
			<StatCard
				label={`Sent (${summary.windowDays}d)`}
				value={summary.sent}
				description={
					summary.replyRate === null
						? "Replies are counted from your synced mailbox"
						: `${formatCount(summary.replied, "reply", "replies")} · ${formatPercent(summary.replyRate)} reply rate`
				}
			/>
			<StatCard
				label="Won after a follow-up (90d)"
				value={money(summary.won.valueCents)}
				description={`${formatCount(summary.won.count, "deal")} closed after a follow-up from here`}
			/>
		</StatGroup>
	);
}

function ScanLine({ summary }: { summary: FollowUpSummary }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const scan = useMutation(
		trpc.followUps.scanNow.mutationOptions({
			onSuccess: () => {
				toast.success("Checking your pipeline now. This takes under a minute.");
				return cache.followUps();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-xs">
			<span className="flex items-center gap-2">
				{summary.scanError ? (
					<StatusIndicator
						tone="error"
						label={`The last check failed: ${summary.scanError}`}
					/>
				) : summary.scannedAt ? (
					<StatusIndicator
						tone="success"
						label={
							<>
								Checked <LocalRelativeTime date={summary.scannedAt} />. Checks
								run every 15 minutes.
							</>
						}
					/>
				) : (
					<StatusIndicator
						tone="warning"
						label="Not checked yet. The agent checks every 15 minutes once it is running."
					/>
				)}
			</span>
			<Button
				variant="outline"
				size="sm"
				disabled={scan.isPending}
				onClick={() => scan.mutate()}
			>
				{scan.isPending ? <Spinner data-icon="inline-start" /> : null}
				Check now
			</Button>
		</div>
	);
}

function GettingStarted() {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<div className="flex flex-col items-start gap-3 p-6">
			<p className="font-medium text-sm">Bring in your contacts to start</p>
			<p className="max-w-prose text-muted-foreground text-xs/relaxed">
				Import a spreadsheet of customers and prospects, or connect your mailbox
				so replies and silences are tracked for you. The first check runs within
				a minute of either.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button asChild size="sm">
					<Link href={workspaceUrl("/settings/import")}>Import a CSV</Link>
				</Button>
				<Button asChild variant="outline" size="sm">
					<Link href={workspaceUrl("/settings/connections")}>
						Connect your mailbox
					</Link>
				</Button>
			</div>
		</div>
	);
}

function FollowUpTableRow({
	row,
	reportingCurrency,
	onOpen,
}: {
	row: FollowUpRow;
	reportingCurrency: string;
	onOpen: () => void;
}) {
	const status = FOLLOW_UP_STATUS[row.status];
	const name = personName(row.contact);

	return (
		<SimpleTableRow clickable onClick={onOpen}>
			<TableCell className={CELL}>
				<span className="flex min-w-0 items-center gap-2">
					<PersonAvatar
						src={row.contact.imageUrl}
						name={name}
						email={row.contact.email}
						size="sm"
					/>
					<span className="flex min-w-0 flex-col">
						<span className="truncate font-medium">{name}</span>
						<span className="truncate text-muted-foreground">
							{row.company?.name ?? row.contact.email}
						</span>
					</span>
				</span>
			</TableCell>
			<TableCell className={CELL}>
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-muted-foreground">
						{FOLLOW_UP_KIND_LABEL[row.kind]}
					</span>
					<span className="line-clamp-2 whitespace-normal text-pretty">
						{row.resolution ?? row.reason}
					</span>
				</span>
			</TableCell>
			<TableCell
				className={`${CELL} hidden text-right tabular-nums md:table-cell`}
			>
				{row.deal?.baseAmountCents ? (
					formatMoneyCompact(row.deal.baseAmountCents, reportingCurrency)
				) : (
					<EmptyCellValue />
				)}
			</TableCell>
			<TableCell className={`${CELL} hidden sm:table-cell`}>
				<StatusIndicator
					tone={status.tone}
					label={
						row.status === "DRAFTING" ? (
							<span className="flex items-center gap-1.5">
								{status.label}
								<Spinner />
							</span>
						) : (
							status.label
						)
					}
				/>
			</TableCell>
			<TableCell
				className={`${CELL} hidden text-right text-muted-foreground lg:table-cell`}
			>
				<LocalRelativeTime date={row.sentAt ?? row.quietSince} />
			</TableCell>
		</SimpleTableRow>
	);
}

import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { FollowUpBoard } from "./follow-up-board";
import {
	FollowUpViewToggle,
	FollowUpViewToggleFallback,
} from "./follow-up-view-toggle";
import { loadFollowUpSearchParams } from "./follow-ups-search-params";

export const metadata: Metadata = {
	title: "Follow-ups",
};

export default function FollowUpsPage({
	searchParams,
}: PageProps<"/[slug]/follow-ups">) {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Follow-ups</PageShellTitle>
					<PageShellDescription>
						Who is waiting on you, why, and a draft ready to send.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<Suspense fallback={<FollowUpViewToggleFallback />}>
						<FollowUpViewToggle />
					</Suspense>
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Board searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Board({
	searchParams,
}: Pick<PageProps<"/[slug]/follow-ups">, "searchParams">) {
	const [, params] = await Promise.all([
		requireSession(),
		loadFollowUpSearchParams(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await Promise.all([
		queryClient.prefetchQuery(trpc.followUps.summary.queryOptions()),
		queryClient.prefetchQuery(
			trpc.followUps.list.queryOptions({
				view: params[SEARCH_PARAM.followUps.view],
			}),
		),
	]);

	return (
		<HydrateClient>
			<FollowUpBoard />
		</HydrateClient>
	);
}

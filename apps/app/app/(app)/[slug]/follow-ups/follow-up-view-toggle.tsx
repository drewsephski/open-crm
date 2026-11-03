"use client";

import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useQueryState } from "nuqs";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import {
	FOLLOW_UP_VIEWS,
	type FollowUpView,
	followUpParsers,
} from "./follow-ups-search-params";

const LABELS = {
	todo: "To do",
	sent: "Sent",
	closed: "Closed",
} satisfies Record<FollowUpView, string>;

function isView(value: string): value is FollowUpView {
	return (FOLLOW_UP_VIEWS as readonly string[]).includes(value);
}

export function FollowUpViewToggleFallback() {
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			disabled
			aria-label="Which follow-ups to show"
		>
			{FOLLOW_UP_VIEWS.map((value) => (
				<ToggleGroupItem key={value} value={value}>
					{LABELS[value]}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

export function FollowUpViewToggle() {
	const [view, setView] = useQueryState(
		SEARCH_PARAM.followUps.view,
		followUpParsers[SEARCH_PARAM.followUps.view],
	);

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			value={view}
			onValueChange={(next) => {
				if (isView(next)) void setView(next);
			}}
			aria-label="Which follow-ups to show"
		>
			{FOLLOW_UP_VIEWS.map((value) => (
				<ToggleGroupItem key={value} value={value}>
					{LABELS[value]}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

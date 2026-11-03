import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export const FOLLOW_UP_VIEWS = ["todo", "sent", "closed"] as const;

export type FollowUpView = (typeof FOLLOW_UP_VIEWS)[number];

export const followUpParsers = {
	[SEARCH_PARAM.followUps.view]:
		parseAsStringLiteral(FOLLOW_UP_VIEWS).withDefault("todo"),
	[SEARCH_PARAM.followUps.open]: parseAsString,
};

export const loadFollowUpSearchParams = createLoader(followUpParsers);

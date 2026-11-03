import { DealStage } from "@crm/db";

export const IMPORTS = {
	batch: { maxRows: 250 },
	field: { short: 200, email: 320, notes: 4000 },
	note: {
		lastContactedSubject: "Last contacted (imported)",
		notesSubject: "Imported notes",
	},
	stageWords: [
		{
			stage: DealStage.CLOSED_WON,
			words: ["won", "closed won", "customer", "signed"],
		},
		{ stage: DealStage.CLOSED_LOST, words: ["lost", "closed lost", "dead"] },
		{
			stage: DealStage.UNQUALIFIED_TO_BUY,
			words: ["unqualified", "disqualified", "not a fit"],
		},
		{
			stage: DealStage.CONTRACT_SENT,
			words: [
				"proposal",
				"quote",
				"contract",
				"estimate",
				"sent",
				"pending signature",
			],
		},
		{
			stage: DealStage.DECISION_MAKER_BOUGHT_IN,
			words: ["negotiation", "negotiating", "decision", "verbal", "committed"],
		},
		{
			stage: DealStage.QUALIFIED_TO_BUY,
			words: ["qualified", "discovery", "interested", "opportunity"],
		},
		{
			stage: DealStage.DEMO_BOOKED,
			words: ["new", "lead", "meeting", "demo", "call booked", "contacted"],
		},
	],
} as const;

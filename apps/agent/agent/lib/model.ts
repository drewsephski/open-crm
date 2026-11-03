import { anthropic } from "@ai-sdk/anthropic";
import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL, readAgentModel } from "@crm/db/settings";
import type { LanguageModel } from "ai";
import { type DynamicResolveContext, defineDynamic } from "eve";
import { defineState } from "eve/context";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

export interface DirectModelSelection {
	model: Exclude<LanguageModel, string>;
	modelContextWindowTokens: number;
}

const sessionModel = defineState<ModelSelection | null>(
	"crm.model",
	() => null,
);

function anthropicSelection(selection: ModelSelection): ModelSelection {
	return selection.model.startsWith("anthropic/")
		? selection
		: {
				model: DEFAULT_AGENT_MODEL.id,
				modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
			};
}

export function directModel(selection: ModelSelection): DirectModelSelection {
	const selected = anthropicSelection(selection);

	return {
		model: anthropic(
			selected.model.slice("anthropic/".length).replaceAll(".", "-"),
		),
		modelContextWindowTokens: selected.modelContextWindowTokens,
	};
}

export function sessionModelDefinition(
	resolve: (ctx: DynamicResolveContext) => Promise<ModelSelection>,
) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const selection = anthropicSelection(await resolve(ctx));
				sessionModel.update(() => selection);
				return selection;
			},
			"step.started": async (_event, ctx) => {
				const selection =
					sessionModel.get() ?? anthropicSelection(await resolve(ctx));
				sessionModel.update(() => selection);
				return directModel(selection);
			},
		},
	});
}

export async function selectedModel(): Promise<ModelSelection> {
	try {
		const setting = await readAgentModel(db);

		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return {
			model: DEFAULT_AGENT_MODEL.id,
			modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
		};
	}
}

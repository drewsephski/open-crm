import { defineAgent } from "eve";
import { selectedModel, sessionModelDefinition } from "../../lib/model";

export default defineAgent({
	description:
		"Turn one private CRM builder-chat request into a validated, reviewable team-agent version without deploying it.",
	model: sessionModelDefinition(selectedModel),
	limits: {
		maxInputTokensPerSession: 100_000,
		maxOutputTokensPerSession: 10_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});

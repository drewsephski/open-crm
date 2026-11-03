import "@crm/env/load";

import { onTelemetryProblem, syncVersion } from "@crm/telemetry";
import { defineAgent } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { selectedModel, sessionModelDefinition } from "./lib/model";

void logCapabilities();

onTelemetryProblem((message) => console.debug(`[telemetry] ${message}`));

void syncVersion();

export default defineAgent({
	model: sessionModelDefinition(selectedModel),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});

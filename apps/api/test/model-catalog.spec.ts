import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createCache } from "cache-manager";
import { ModelCatalogService } from "../src/settings/model-catalog.service";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

afterEach(() => fetchSpy?.mockRestore());

describe("Anthropic model catalog", () => {
	it("excludes other providers, batch models, and models without tools", async () => {
		const model = {
			id: "anthropic/claude-haiku-5.5",
			name: "Claude Haiku 5.5",
			owned_by: "anthropic",
			type: "language",
			tags: ["tool-use"],
			context_window: 1_000_000,
			pricing: { input: "0.0000001", output: "0.0000005" },
		};
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				data: [
					model,
					{ ...model, id: "openai/gpt-5.5", owned_by: "openai" },
					{ ...model, id: "anthropic/claude-haiku-5.5-batch" },
					{ ...model, id: "anthropic/no-tools", tags: [] },
				],
			}),
		);
		const catalog = new ModelCatalogService(createCache());

		expect(await catalog.models()).toEqual([
			{
				id: model.id,
				name: model.name,
				provider: "anthropic",
				contextWindowTokens: 1_000_000,
				pricing: { input: 0.0000001, output: 0.0000005 },
			},
		]);
		expect(await catalog.find("openai/gpt-5.5")).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

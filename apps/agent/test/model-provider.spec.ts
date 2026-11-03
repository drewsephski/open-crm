import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { generateText, streamText } from "ai";
import { z } from "zod";
import { directModel } from "../agent/lib/model";

const originalKey = process.env.ANTHROPIC_API_KEY;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

afterEach(() => {
	fetchSpy?.mockRestore();
	if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
	else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe("direct Anthropic models", () => {
	it("uses Haiku 5.5 without requiring credentials during model construction", () => {
		delete process.env.ANTHROPIC_API_KEY;
		const selection = directModel({
			model: DEFAULT_AGENT_MODEL.id,
			modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
		});

		expect(selection.model.provider).toBe("anthropic.messages");
		expect(selection.model.modelId).toBe("claude-haiku-5-5");
		expect(selection.modelContextWindowTokens).toBe(1_000_000);
	});

	it("preserves the chosen Anthropic model and context window", () => {
		const selection = directModel({
			model: "anthropic/claude-sonnet-5.5",
			modelContextWindowTokens: 200_000,
		});

		expect(selection.model.modelId).toBe("claude-sonnet-5-5");
		expect(selection.modelContextWindowTokens).toBe(200_000);
	});

	it.each([
		"zai/glm-5.2-fast",
		"anthropic/claude-opus-5.5-fast",
		"anthropic/claude-haiku-5.5-batch",
	])("replaces unsupported selection %s with the complete default", (model) => {
		const selection = directModel({
			model,
			modelContextWindowTokens: 200_000,
		});

		expect(selection.model.modelId).toBe("claude-haiku-5-5");
		expect(selection.modelContextWindowTokens).toBe(1_000_000);
	});

	it("sends an SDK generation directly to the Anthropic Messages API", async () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				id: "msg_test",
				type: "message",
				role: "assistant",
				model: "claude-haiku-5-5",
				content: [{ type: "text", text: "Ready." }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 5, output_tokens: 2 },
			}),
		);

		const selection = directModel({
			model: DEFAULT_AGENT_MODEL.id,
			modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
		});
		const result = await generateText({
			model: selection.model,
			prompt: "Confirm readiness.",
		});

		expect(result.text).toBe("Ready.");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
		expect(new Headers(init?.headers).get("x-api-key")).toBe(
			"test-anthropic-key",
		);
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "claude-haiku-5-5",
		});
	});

	it("preserves streamed tool calls through the Anthropic provider", async () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_tool",
					type: "message",
					role: "assistant",
					model: "claude-haiku-5-5",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 5, output_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "tool_test",
					name: "inspect_record",
					input: {},
				},
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "input_json_delta", partial_json: '{"id":"record_1"}' },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "tool_use", stop_sequence: null },
				usage: { output_tokens: 10 },
			},
			{ type: "message_stop" },
		];
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
				{ headers: { "content-type": "text/event-stream" } },
			),
		);
		const selection = directModel({
			model: DEFAULT_AGENT_MODEL.id,
			modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
		});
		const result = streamText({
			model: selection.model,
			prompt: "Inspect record_1.",
			tools: {
				inspect_record: { inputSchema: z.object({ id: z.string() }) },
			},
		});

		expect(await result.toolCalls).toMatchObject([
			{
				toolCallId: "tool_test",
				toolName: "inspect_record",
				input: { id: "record_1" },
			},
		]);
		expect(await result.finishReason).toBe("tool-calls");
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
		expect(JSON.parse(String(init?.body))).toMatchObject({
			stream: true,
			model: "claude-haiku-5-5",
			tools: [{ name: "inspect_record" }],
		});
	});
});

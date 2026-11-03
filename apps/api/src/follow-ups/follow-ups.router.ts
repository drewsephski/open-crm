import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { FollowUpMailboxService } from "./follow-up-mailbox.service";
import {
	followUpDismissInput,
	followUpDraftInput,
	followUpIdInput,
	followUpListInput,
	followUpListOutput,
	followUpMailboxDraftOutput,
	followUpMutationOutput,
	followUpScanOutput,
	followUpSnoozeInput,
	followUpSummaryOutput,
} from "./follow-ups.contracts";
import { FollowUpsService } from "./follow-ups.service";

@Router({ alias: "followUps" })
@UseMiddlewares(AuthMiddleware)
export class FollowUpsRouter {
	constructor(
		@Inject(FollowUpsService) private readonly followUps: FollowUpsService,
		@Inject(FollowUpMailboxService)
		private readonly mailbox: FollowUpMailboxService,
	) {}

	@Query({
		input: followUpListInput,
		output: followUpListOutput,
		meta: restMeta("GET", "/follow-ups", ["Follow-ups"]),
	})
	async list(@Input() input: z.infer<typeof followUpListInput>) {
		return this.followUps.list(input);
	}

	@Query({
		output: followUpSummaryOutput,
		meta: restMeta("GET", "/follow-ups/summary", ["Follow-ups"]),
	})
	async summary(@Ctx() ctx: AuthedTrpcContext) {
		return this.followUps.summary(ctx.user.id);
	}

	@Mutation({
		input: followUpDraftInput,
		output: followUpMutationOutput,
		meta: restMeta("PATCH", "/follow-ups/{id}/draft", ["Follow-ups"]),
	})
	async saveDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpDraftInput>,
	) {
		return this.followUps.saveDraft(input, ctx.user.id);
	}

	@Mutation({
		input: followUpDraftInput,
		output: followUpMutationOutput,
		meta: restMeta("POST", "/follow-ups/{id}/approve", ["Follow-ups"]),
	})
	async approve(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpDraftInput>,
	) {
		return this.followUps.approve(input, ctx.user.id);
	}

	@Mutation({
		input: followUpIdInput,
		output: followUpMutationOutput,
		meta: restMeta("POST", "/follow-ups/{id}/sent", ["Follow-ups"]),
	})
	async markSent(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpIdInput>,
	) {
		return this.followUps.markSent(input.id, ctx.user.id);
	}

	@Mutation({
		input: followUpDismissInput,
		output: followUpMutationOutput,
		meta: restMeta("POST", "/follow-ups/{id}/dismiss", ["Follow-ups"]),
	})
	async dismiss(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpDismissInput>,
	) {
		return this.followUps.dismiss(input.id, input.reason, ctx.user.id);
	}

	@Mutation({
		input: followUpSnoozeInput,
		output: followUpMutationOutput,
		meta: restMeta("POST", "/follow-ups/{id}/snooze", ["Follow-ups"]),
	})
	async snooze(@Input() input: z.infer<typeof followUpSnoozeInput>) {
		return this.followUps.snooze(input.id, input.days);
	}

	@Mutation({
		input: followUpIdInput,
		output: followUpMutationOutput,
		meta: restMeta("POST", "/follow-ups/{id}/draft-request", ["Follow-ups"]),
	})
	async requestDraft(@Input() input: z.infer<typeof followUpIdInput>) {
		return this.followUps.requestDraft(input.id);
	}

	@Mutation({ input: followUpIdInput, output: followUpMailboxDraftOutput })
	async openMailboxDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpIdInput>,
	) {
		return this.mailbox.openDraft(input.id, ctx.user.id);
	}

	@Mutation({
		output: followUpScanOutput,
		meta: restMeta("POST", "/follow-ups/scan", ["Follow-ups"]),
	})
	async scanNow() {
		return this.followUps.scanNow();
	}
}

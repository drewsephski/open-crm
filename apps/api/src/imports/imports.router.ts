import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { importInput, importOutput } from "./imports.contracts";
import { ImportsService } from "./imports.service";

@Router({ alias: "imports" })
@UseMiddlewares(AuthMiddleware)
export class ImportsRouter {
	constructor(
		@Inject(ImportsService) private readonly imports: ImportsService,
	) {}

	@Mutation({
		input: importInput,
		output: importOutput,
		meta: restMeta("POST", "/imports/contacts", ["Imports"]),
	})
	async contacts(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof importInput>,
	) {
		return this.imports.contacts(input, ctx.user.id);
	}
}

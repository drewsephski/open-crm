import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CurrencyModule } from "../currency/currency.module";
import { TrpcModule } from "../trpc/trpc.module";
import { FollowUpsRouter } from "./follow-ups.router";
import { FollowUpsService } from "./follow-ups.service";

@Module({
	imports: [TrpcModule, CurrencyModule, AgentModule],
	providers: [FollowUpsService, FollowUpsRouter],
})
export class FollowUpsModule {}

import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CurrencyModule } from "../currency/currency.module";
import { MailboxModule } from "../mailbox/mailbox.module";
import { TrpcModule } from "../trpc/trpc.module";
import { FollowUpMailboxService } from "./follow-up-mailbox.service";
import { FollowUpsRouter } from "./follow-ups.router";
import { FollowUpsService } from "./follow-ups.service";

@Module({
	imports: [TrpcModule, CurrencyModule, AgentModule, MailboxModule],
	providers: [FollowUpsService, FollowUpsRouter, FollowUpMailboxService],
})
export class FollowUpsModule {}

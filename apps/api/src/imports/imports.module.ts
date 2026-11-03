import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CurrencyModule } from "../currency/currency.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ImportsRouter } from "./imports.router";
import { ImportsService } from "./imports.service";

@Module({
	imports: [TrpcModule, CurrencyModule, AgentModule],
	providers: [ImportsService, ImportsRouter],
})
export class ImportsModule {}

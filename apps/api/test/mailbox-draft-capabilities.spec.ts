import { afterAll, describe, expect, it } from "bun:test";
import {
	GMAIL_DRAFT_SCOPE,
	GMAIL_SCOPE,
	OUTLOOK_DRAFT_SCOPE,
	OUTLOOK_MAIL_SCOPE,
} from "@crm/auth/scopes";
import { db } from "@crm/db";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import { GoogleConnectionService } from "../src/google/google-connection.service";
import { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import { MailboxTokenService } from "../src/mailbox/mailbox-token.service";
import { SyncStateService } from "../src/mailbox/sync-state.service";
import { MicrosoftConnectionService } from "../src/microsoft/microsoft-connection.service";

const suffix = crypto.randomUUID();
const userIds: string[] = [];
const tokens = new MailboxTokenService(db);
const state = new SyncStateService(db);
const stamp = new ActivityStampService(db);
const agent = new AgentTriggerService(db);
const match = new MailboxMatchService(
	db,
	new CompanyDirectoryService(agent),
	agent,
	new EnrichmentLogService(db, stamp),
);

afterAll(async () => {
	await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("mailbox draft capabilities", () => {
	for (const entry of [
		{
			provider: "google",
			read: GMAIL_SCOPE,
			write: GMAIL_DRAFT_SCOPE,
			service: new GoogleConnectionService(db, tokens, state, match, stamp),
		},
		{
			provider: "microsoft",
			read: OUTLOOK_MAIL_SCOPE,
			write: OUTLOOK_DRAFT_SCOPE,
			service: new MicrosoftConnectionService(db, tokens, state, stamp),
		},
	]) {
		it(`keeps ${entry.provider} read access separate from draft access`, async () => {
			const id = `draft-capability-${entry.provider}-${suffix}`;
			userIds.push(id);
			await db.user.create({
				data: {
					id,
					name: "Draft rep",
					email: `${id}@example.test`,
					accounts: {
						create: {
							id: `${id}-account`,
							accountId: id,
							providerId: entry.provider,
							scope: entry.read,
						},
					},
				},
			});
			const before = await entry.service.status(id);
			expect(before.linked).toBe(true);
			expect(before.canDraft).toBe(false);
			await db.account.update({
				where: { id: `${id}-account` },
				data: { scope: `${entry.read} ${entry.write}` },
			});
			const after = await entry.service.status(id);
			expect(after.linked).toBe(true);
			expect(after.canDraft).toBe(true);
		});
	}
});

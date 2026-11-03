import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GOOGLE_PROVIDER_ID, SYNC_SCOPES } from "@crm/auth/scopes";
import { db } from "@crm/db";
import { MailboxTokenService } from "../src/mailbox/mailbox-token.service";

const suffix = process.env.TEST_RUN_ID ?? "mailbox-token-spec";
const ownerId = `mailbox-token-owner-${suffix}`;
const otherId = `mailbox-token-other-${suffix}`;
const ungrantedId = `mailbox-token-ungranted-${suffix}`;
const userIds = [ownerId, otherId, ungrantedId];
const tokens = new MailboxTokenService(db);

beforeAll(async () => {
	for (const id of userIds) {
		await db.user.create({
			data: {
				id,
				name: "Token test",
				email: `${id}@example.test`,
				accounts: {
					create: {
						id: `${id}-local-account`,
						accountId: `${id}-provider-account`,
						providerId: GOOGLE_PROVIDER_ID,
						accessToken: `${id}-token`,
						scope: id === ungrantedId ? "openid email" : SYNC_SCOPES.join(" "),
					},
				},
			},
		});
	}
});

afterAll(async () => {
	await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("mailbox account token selection", () => {
	it("selects the local account row for the requested user", async () => {
		expect(await tokens.accessTokenFor(ownerId, "gmail")).toEqual({
			outcome: "ok",
			accessToken: `${ownerId}-token`,
		});
		expect(await tokens.accessTokenFor(otherId, "gmail")).toEqual({
			outcome: "ok",
			accessToken: `${otherId}-token`,
		});
	});

	it("refuses an account without the mailbox scope", async () => {
		expect(await tokens.accessTokenFor(ungrantedId, "gmail")).toEqual({
			outcome: "not-connected",
			reason: "The gmail scope has not been granted.",
		});
	});

	it("does not use a different user's connected account", async () => {
		expect(await tokens.accessTokenFor(`${ownerId}-missing`, "gmail")).toEqual({
			outcome: "not-connected",
			reason: "The gmail scope has not been granted.",
		});
	});
});

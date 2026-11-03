import { db } from "@crm/db";
import { scanFollowUps } from "../agent/lib/follow-ups";

const sweep = await scanFollowUps({ force: true });

if (sweep.error) {
	console.error(`Follow-up scan failed: ${sweep.error}`);
	await db.$disconnect();
	process.exit(1);
}

console.log(
	[
		`Checked ${sweep.contacts} contacts.`,
		`${sweep.created} new follow-ups, ${sweep.resolved} resolved, ${sweep.sent} confirmed sent, ${sweep.replied} replies, ${sweep.woken} back from snooze.`,
		`${sweep.draftsQueued} drafts queued for the agent, ${sweep.draftsFailed} drafts failed.`,
	].join("\n"),
);

await db.$disconnect();

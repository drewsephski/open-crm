import { db } from "../src/client";
import {
	DealStage,
	EmailDirection,
	FollowUpKind,
	FollowUpStatus,
	RecordSource,
} from "../src/generated/prisma/enums";
import { readReportingCurrency, requestFollowUpScan } from "../src/settings";

const DEMO_TLD = ".example";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const reset = process.argv.includes("--reset");

function daysAgo(days: number): Date {
	return new Date(NOW - days * DAY_MS);
}

type Message = {
	from: "us" | "them";
	daysAgo: number;
	body: string;
};

type DemoPerson = {
	firstName: string;
	lastName: string;
	title: string;
	company: string;
	domain: string;
	source?: RecordSource;
	subject?: string;
	messages?: Message[];
	deal?: {
		name: string;
		stage: DealStage;
		amount: number;
		stageDaysAgo: number;
		closedDaysAgo?: number;
	};
	meetingInDays?: number;
	history?: { sentDaysAgo: number; repliedDaysAgo: number };
};

const PEOPLE: DemoPerson[] = [
	{
		firstName: "Priya",
		lastName: "Shah",
		title: "Practice Manager",
		company: "Harbor Dental Group",
		domain: `harbordental${DEMO_TLD}`,
		subject: "New website before our second location opens",
		messages: [
			{
				from: "them",
				daysAgo: 2,
				body: "Hi, we are opening a second location in January and our website is badly out of date. Could you send rough pricing for a 10-page site with online booking? We would want it live by mid-December if possible.\n\nThanks,\nPriya",
			},
		],
	},
	{
		firstName: "Marcus",
		lastName: "Webb",
		title: "Owner",
		company: "Greenline Landscaping",
		domain: `greenlinelandscaping${DEMO_TLD}`,
		subject: "Greenline website + SEO proposal",
		messages: [
			{
				from: "them",
				daysAgo: 11,
				body: "Good call today. Send over the proposal when it is ready. My main worry is showing up for 'landscaper near me' before spring.",
			},
			{
				from: "us",
				daysAgo: 9,
				body: "Hi Marcus,\n\nProposal attached: a rebuilt 8-page site plus a 6-month local SEO retainer, $14,500 in total. The SEO work starts in week one so you are ranking before spring.\n\nHappy to walk through it on a call.\n\nDrew",
			},
		],
		deal: {
			name: "Greenline website + SEO retainer",
			stage: DealStage.CONTRACT_SENT,
			amount: 14_500,
			stageDaysAgo: 9,
		},
	},
	{
		firstName: "Elena",
		lastName: "Rossi",
		title: "Partner",
		company: "Rossi & Co Accounting",
		domain: `rossiaccounting${DEMO_TLD}`,
		subject: "Brand refresh options",
		messages: [
			{
				from: "them",
				daysAgo: 20,
				body: "We have had the same logo since 2009. Do you do brand refreshes for small firms like ours, or only websites?",
			},
			{
				from: "us",
				daysAgo: 7,
				body: "Hi Elena,\n\nWe do. Two options: a light refresh of the existing mark and colours ($3,500), or a full rebrand with a new site ($6,000). Most firms your size pick the first.\n\nWhich sounds closer?\n\nDrew",
			},
		],
		deal: {
			name: "Rossi brand refresh",
			stage: DealStage.QUALIFIED_TO_BUY,
			amount: 6_000,
			stageDaysAgo: 7,
		},
	},
	{
		firstName: "Tom",
		lastName: "Becker",
		title: "Owner",
		company: "Becker Plumbing",
		domain: `beckerplumbing${DEMO_TLD}`,
		subject: "Local SEO for Becker Plumbing",
		messages: [
			{
				from: "them",
				daysAgo: 51,
				body: "My business partner is on board with the SEO plan. We just need to sort out the start date.",
			},
			{
				from: "us",
				daysAgo: 50,
				body: "Great news, Tom. We can start any Monday. Let me know which works and I will send the agreement.",
			},
		],
		deal: {
			name: "Becker Plumbing local SEO",
			stage: DealStage.DECISION_MAKER_BOUGHT_IN,
			amount: 9_000,
			stageDaysAgo: 51,
		},
	},
	{
		firstName: "Aisha",
		lastName: "Karim",
		title: "Founder",
		company: "Lumen Yoga Studio",
		domain: `lumenyoga${DEMO_TLD}`,
		subject: "Class schedule page",
		messages: [
			{
				from: "them",
				daysAgo: 150,
				body: "The new class schedule page is perfect. Students are booking without calling us now. Thank you!",
			},
			{
				from: "us",
				daysAgo: 149,
				body: "So glad to hear it, Aisha. Shout if you ever want the retreat pages done the same way.",
			},
		],
		deal: {
			name: "Lumen website rebuild",
			stage: DealStage.CLOSED_WON,
			amount: 5_200,
			stageDaysAgo: 160,
			closedDaysAgo: 160,
		},
	},
	{
		firstName: "Jordan",
		lastName: "Lee",
		title: "Operations Lead",
		company: "Summit Roofing",
		domain: `summitroofing${DEMO_TLD}`,
		subject: "Your Google reviews are great, your site is not",
		messages: [
			{
				from: "us",
				daysAgo: 6,
				body: "Hi Jordan,\n\nSummit has 140 five-star Google reviews, but the website does not show a single one, and it is hard to read on a phone. We rebuild sites for roofers so the reviews do the selling.\n\nWorth a 15-minute look?\n\nDrew",
			},
		],
	},
	{
		firstName: "Leah",
		lastName: "Morgan",
		title: "Clinic Director",
		company: "Coastal Physio",
		domain: `coastalphysio${DEMO_TLD}`,
		source: RecordSource.IMPORT,
	},
	{
		firstName: "Ben",
		lastName: "Okafor",
		title: "Owner",
		company: "Oak & Iron Fitness",
		domain: `oakandiron${DEMO_TLD}`,
		source: RecordSource.IMPORT,
	},
	{
		firstName: "Sam",
		lastName: "Ortiz",
		title: "Managing Partner",
		company: "Ortiz Law",
		domain: `ortizlaw${DEMO_TLD}`,
		subject: "Practice area pages",
		messages: [
			{
				from: "them",
				daysAgo: 1.2,
				body: "Can we add a page for estate planning?",
			},
			{
				from: "us",
				daysAgo: 0.8,
				body: "Yes. I will have a draft for you by Thursday.",
			},
		],
	},
	{
		firstName: "Nina",
		lastName: "Patel",
		title: "Pharmacist & Owner",
		company: "Patel Pharmacy",
		domain: `patelpharmacy${DEMO_TLD}`,
		subject: "Proposal: refill request form",
		messages: [
			{
				from: "us",
				daysAgo: 2,
				body: "Hi Nina, proposal attached for the online refill form. $4,800 including the HIPAA-compliant form provider.",
			},
		],
		deal: {
			name: "Patel refill request form",
			stage: DealStage.CONTRACT_SENT,
			amount: 4_800,
			stageDaysAgo: 2,
		},
	},
	{
		firstName: "Chris",
		lastName: "Young",
		title: "Owner",
		company: "Young Electric",
		domain: `youngelectric${DEMO_TLD}`,
		subject: "Quick question about your packages",
		messages: [
			{
				from: "them",
				daysAgo: 4,
				body: "What is included in your starter package? Happy to talk it through on Thursday.",
			},
		],
		meetingInDays: 3,
	},
	{
		firstName: "Dana",
		lastName: "Reyes",
		title: "Creative Director",
		company: "Reyes Studio",
		domain: `reyesstudio${DEMO_TLD}`,
		subject: "Portfolio site",
		messages: [
			{
				from: "us",
				daysAgo: 25,
				body: "Hi Dana, just checking the portfolio proposal reached you. Happy to adjust the scope.",
			},
			{
				from: "them",
				daysAgo: 23,
				body: "Thanks for the nudge. It got buried. Let's go ahead with the full version.",
			},
			{
				from: "us",
				daysAgo: 22,
				body: "Brilliant. Agreement attached; we can start Monday.",
			},
		],
		deal: {
			name: "Reyes portfolio site",
			stage: DealStage.CLOSED_WON,
			amount: 8_000,
			stageDaysAgo: 21,
			closedDaysAgo: 21,
		},
		history: { sentDaysAgo: 25, repliedDaysAgo: 23 },
	},
];

async function clear(): Promise<void> {
	const companies = await db.company.findMany({
		where: { domain: { endsWith: DEMO_TLD } },
		select: { id: true },
	});
	const companyIds = companies.map((row) => row.id);
	const contacts = await db.contact.findMany({
		where: {
			OR: [
				{ companyId: { in: companyIds } },
				{ email: { endsWith: DEMO_TLD } },
			],
		},
		select: { id: true },
	});
	const contactIds = contacts.map((row) => row.id);

	await db.agentTask.deleteMany({
		where: {
			OR: [
				{ contactId: { in: contactIds } },
				{ companyId: { in: companyIds } },
			],
		},
	});
	await db.followUp.deleteMany({ where: { contactId: { in: contactIds } } });
	await db.calendarEvent.deleteMany({
		where: { iCalUid: { endsWith: `@demo${DEMO_TLD}` } },
	});
	await db.emailThread.deleteMany({
		where: { rootMessageId: { endsWith: `@demo${DEMO_TLD}>` } },
	});
	await db.activity.deleteMany({
		where: {
			OR: [
				{ contactId: { in: contactIds } },
				{ companyId: { in: companyIds } },
			],
		},
	});
	await db.deal.deleteMany({ where: { companyId: { in: companyIds } } });
	await db.contact.deleteMany({ where: { id: { in: contactIds } } });
	await db.company.deleteMany({ where: { id: { in: companyIds } } });
}

async function owner(): Promise<{ id: string; email: string; name: string }> {
	const existing = await db.user.findFirst({
		orderBy: { createdAt: "asc" },
		select: { id: true, email: true, name: true },
	});
	if (existing) return existing;

	return db.user.create({
		data: {
			id: "demo-owner",
			name: "Demo Owner",
			email: `owner@demo${DEMO_TLD}`,
			emailVerified: true,
		},
		select: { id: true, email: true, name: true },
	});
}

async function seedPerson(
	person: DemoPerson,
	rep: { id: string; email: string; name: string },
	reporting: string,
): Promise<void> {
	const email = `${person.firstName.toLowerCase()}@${person.domain}`;

	const company = await db.company.create({
		data: {
			name: person.company,
			domain: person.domain,
			website: `https://${person.domain}`,
			ownerId: rep.id,
			source: person.source ?? RecordSource.EMAIL,
			enrichmentStatus: "SKIPPED",
		},
	});

	const contact = await db.contact.create({
		data: {
			firstName: person.firstName,
			lastName: person.lastName,
			title: person.title,
			email,
			companyId: company.id,
			ownerId: rep.id,
			source: person.source ?? RecordSource.EMAIL,
			enrichmentStatus: "SKIPPED",
			createdAt:
				person.source === RecordSource.IMPORT ? daysAgo(1) : daysAgo(60),
		},
	});

	await db.company.update({
		where: { id: company.id },
		data: { primaryContactId: contact.id },
	});

	if (person.messages && person.messages.length > 0) {
		const sorted = [...person.messages].sort((a, b) => b.daysAgo - a.daysAgo);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (!first || !last) return;

		const thread = await db.emailThread.create({
			data: {
				rootMessageId: `<${contact.id}@demo${DEMO_TLD}>`,
				subject: person.subject ?? null,
				companyId: company.id,
				contactId: contact.id,
				firstMessageAt: daysAgo(first.daysAgo),
				lastMessageAt: daysAgo(last.daysAgo),
				messageCount: sorted.length,
			},
		});

		for (const [index, message] of sorted.entries()) {
			const ours = message.from === "us";
			await db.emailMessage.create({
				data: {
					threadId: thread.id,
					rfcMessageId: `<${contact.id}-${index}@demo${DEMO_TLD}>`,
					direction: ours ? EmailDirection.OUTBOUND : EmailDirection.INBOUND,
					fromEmail: ours ? rep.email : email,
					fromName: ours ? rep.name : `${person.firstName} ${person.lastName}`,
					recipients: [
						{
							email: ours ? email : rep.email,
							name: ours ? `${person.firstName} ${person.lastName}` : rep.name,
							kind: "to",
						},
					],
					subject: index === 0 ? person.subject : `Re: ${person.subject}`,
					snippet: message.body.slice(0, 140),
					body: message.body,
					sentAt: daysAgo(message.daysAgo),
				},
			});
		}

		await db.activity.create({
			data: {
				type: "EMAIL",
				subject: person.subject ?? null,
				occurredAt: daysAgo(last.daysAgo),
				companyId: company.id,
				contactId: contact.id,
				createdById: rep.id,
				emailThreadId: thread.id,
			},
		});

		const touched = daysAgo(last.daysAgo);
		await db.contact.update({
			where: { id: contact.id },
			data: { lastActivityAt: touched },
		});
		await db.company.update({
			where: { id: company.id },
			data: { lastActivityAt: touched },
		});
	}

	let dealId: string | null = null;
	if (person.deal) {
		const amount = person.deal.amount.toFixed(2);
		const closedAt =
			person.deal.closedDaysAgo === undefined
				? null
				: daysAgo(person.deal.closedDaysAgo);
		const deal = await db.deal.create({
			data: {
				name: person.deal.name,
				companyId: company.id,
				ownerId: rep.id,
				stage: person.deal.stage,
				stageChangedAt: daysAgo(person.deal.stageDaysAgo),
				closedAt,
				amount,
				currency: reporting,
				baseAmount: amount,
				baseCurrency: reporting,
				fxRate: "1",
				fxRateAt: new Date(),
				createdAt: daysAgo(person.deal.stageDaysAgo + 5),
			},
		});
		dealId = deal.id;
		await db.dealContact.create({
			data: { dealId: deal.id, contactId: contact.id, role: "Decision maker" },
		});
	}

	if (person.meetingInDays !== undefined) {
		const startsAt = new Date(NOW + person.meetingInDays * DAY_MS);
		const event = await db.calendarEvent.create({
			data: {
				iCalUid: `${contact.id}@demo${DEMO_TLD}`,
				originalStartTime: startsAt,
				title: `Intro call with ${person.firstName}`,
				startsAt,
				endsAt: new Date(startsAt.getTime() + 30 * 60_000),
				status: "confirmed",
				companyId: company.id,
				contactId: contact.id,
			},
		});
		await db.calendarAttendee.create({
			data: { eventId: event.id, email, contactId: contact.id },
		});
	}

	if (person.history) {
		await db.followUp.create({
			data: {
				kind: FollowUpKind.PROPOSAL,
				status: FollowUpStatus.REPLIED,
				contactId: contact.id,
				companyId: company.id,
				dealId,
				reason: `The proposal for “${person.deal?.name ?? person.company}” had no response for 6 days.`,
				signal: {
					evidence: "deal",
					daysQuiet: 6,
					lastInboundAt: null,
					lastOutboundAt: daysAgo(31).toISOString(),
					lastTouchAt: daysAgo(31).toISOString(),
					threadId: null,
					threadSubject: person.subject ?? null,
					dealStage: DealStage.CONTRACT_SENT,
				},
				priority: 860,
				quietSince: daysAgo(31),
				draftSubject: `Re: ${person.subject}`,
				draftBody:
					"Hi Dana, just checking the portfolio proposal reached you. Happy to adjust the scope.",
				draftedAt: daysAgo(25),
				approvedById: rep.id,
				approvedAt: daysAgo(25),
				sentAt: daysAgo(person.history.sentDaysAgo),
				repliedAt: daysAgo(person.history.repliedDaysAgo),
				createdAt: daysAgo(26),
			},
		});
	}
}

await clear();

if (reset) {
	console.log("Removed the demo records.");
} else {
	const rep = await owner();
	const reporting = await readReportingCurrency(db);

	for (const person of PEOPLE) {
		await seedPerson(person, rep, reporting);
	}

	await requestFollowUpScan(db);

	console.log(
		[
			`Seeded ${PEOPLE.length} demo contacts owned by ${rep.name}.`,
			"Expected follow-ups: Priya (unanswered), Marcus (proposal), Elena (no reply),",
			"Tom (stalled deal), Aisha (gone quiet), Jordan (cold no reply), Leah and Ben (new leads).",
			"Expected to stay quiet: Sam (answered), Nina (proposal sent 2 days ago), Chris (meeting booked), Dana (won).",
			"",
			"Run the check now:  bun run --filter=agent follow-ups:scan",
			"Remove it later:    bun run --filter=@crm/db db:demo -- --reset",
		].join("\n"),
	);
}

await db.$disconnect();

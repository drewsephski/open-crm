"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { LocalRelativeTime } from "@/components/local-date-time";
import {
	composeUrl,
	DISMISSAL_LABEL,
	type Dismissal,
	FOLLOW_UP_KIND_LABEL,
	FOLLOW_UP_STATUS,
	type FollowUpRow,
	MAILBOX_LABEL,
	type Mailbox,
	personName,
	SNOOZE_DAYS,
} from "@/lib/follow-up-presentation";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const EDITABLE = new Set(["OPEN", "DRAFTING", "READY", "APPROVED", "SNOOZED"]);

export function FollowUpReviewSheet({
	row,
	mailbox,
	onClose,
}: {
	row: FollowUpRow | null;
	mailbox: Mailbox;
	onClose: () => void;
}) {
	return (
		<Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent side="right" size="md">
				{row ? (
					<Review
						key={`${row.id}:${row.draft?.draftedAt ?? "none"}:${row.status}`}
						row={row}
						mailbox={mailbox}
						onClose={onClose}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function Review({
	row,
	mailbox,
	onClose,
}: {
	row: FollowUpRow;
	mailbox: Mailbox;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const subjectId = useId();
	const bodyId = useId();

	const [subject, setSubject] = useState(
		row.draft?.subject ??
			(row.signal.threadSubject ? `Re: ${row.signal.threadSubject}` : ""),
	);
	const [body, setBody] = useState(row.draft?.body ?? "");

	const name = personName(row.contact);
	const to = row.contact.email ?? "";
	const editable = EDITABLE.has(row.status);
	const draftEditable = editable && row.status !== "APPROVED";
	const ready = subject.trim() !== "" && body.trim() !== "" && to !== "";
	const status = FOLLOW_UP_STATUS[row.status];
	const where = mailbox ? MAILBOX_LABEL[mailbox] : "your email app";

	const settled = (message: string, close = true) => {
		toast.success(message);
		if (close) onClose();
		return cache.followUps();
	};
	const failed = (error: { message: string }) => toast.error(error.message);

	const approve = useMutation(
		trpc.followUps.approve.mutationOptions({
			onSuccess: () =>
				settled(
					mailbox
						? `Approved. Send it from ${where}; the CRM confirms it once your mailbox syncs.`
						: "Approved. Send it, then mark it as sent.",
					false,
				),
			onError: failed,
		}),
	);
	const openMailboxDraft = useMutation(
		trpc.followUps.openMailboxDraft.mutationOptions({ onError: failed }),
	);
	const openEmail = async (needsApproval: boolean, threaded: boolean) => {
		const popup = window.open("", "_blank");
		if (popup) popup.opener = null;
		try {
			if (needsApproval)
				await approve.mutateAsync({ id: row.id, subject, body });
			const url = threaded
				? (await openMailboxDraft.mutateAsync({ id: row.id })).url
				: composeUrl(mailbox, to, subject, body);
			if (popup) popup.location.href = url;
			else toast.error("Allow popups, then open the approved email again.");
		} catch {
			popup?.close();
		}
	};
	const save = useMutation(
		trpc.followUps.saveDraft.mutationOptions({
			onSuccess: () => settled("Draft saved.", false),
			onError: failed,
		}),
	);
	const markSent = useMutation(
		trpc.followUps.markSent.mutationOptions({
			onSuccess: () => settled(`Marked as sent to ${name}.`),
			onError: failed,
		}),
	);
	const dismiss = useMutation(
		trpc.followUps.dismiss.mutationOptions({
			onSuccess: () => settled("Dismissed."),
			onError: failed,
		}),
	);
	const snooze = useMutation(
		trpc.followUps.snooze.mutationOptions({
			onSuccess: () => settled("Snoozed."),
			onError: failed,
		}),
	);
	const redraft = useMutation(
		trpc.followUps.requestDraft.mutationOptions({
			onSuccess: () => settled("The agent is drafting it now.", false),
			onError: failed,
		}),
	);

	const busy =
		approve.isPending ||
		openMailboxDraft.isPending ||
		save.isPending ||
		markSent.isPending ||
		dismiss.isPending ||
		snooze.isPending ||
		redraft.isPending;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
			toast.success("Copied.");
		} catch {
			toast.error("The browser refused to copy. Select the text instead.");
		}
	};

	return (
		<>
			<SheetHeader>
				<SheetTitle>{name}</SheetTitle>
				<SheetDescription>{row.resolution ?? row.reason}</SheetDescription>
			</SheetHeader>

			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4">
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
					<dt className="text-muted-foreground">Status</dt>
					<dd>
						<StatusIndicator tone={status.tone} label={status.label} />
					</dd>
					<dt className="text-muted-foreground">Why</dt>
					<dd>
						{FOLLOW_UP_KIND_LABEL[row.kind]} · quiet{" "}
						<LocalRelativeTime date={row.quietSince} />
					</dd>
					<dt className="text-muted-foreground">Contact</dt>
					<dd className="flex min-w-0">
						<RecordLink kind="contact" id={row.contact.id}>
							{row.contact.title ? `${name}, ${row.contact.title}` : name}
						</RecordLink>
					</dd>
					{row.company ? (
						<>
							<dt className="text-muted-foreground">Company</dt>
							<dd className="flex min-w-0">
								<RecordLink kind="company" id={row.company.id}>
									{row.company.name}
								</RecordLink>
							</dd>
						</>
					) : null}
					{row.deal ? (
						<>
							<dt className="text-muted-foreground">Deal</dt>
							<dd className="flex min-w-0">
								<RecordLink kind="deal" id={row.deal.id}>
									{row.deal.name}
								</RecordLink>
							</dd>
						</>
					) : null}
					{row.sentAt ? (
						<>
							<dt className="text-muted-foreground">Sent</dt>
							<dd>
								<LocalRelativeTime date={row.sentAt} />
								{row.approvedBy ? ` · approved by ${row.approvedBy}` : ""}
							</dd>
						</>
					) : null}
					{row.repliedAt ? (
						<>
							<dt className="text-muted-foreground">Replied</dt>
							<dd>
								<LocalRelativeTime date={row.repliedAt} />
							</dd>
						</>
					) : null}
				</dl>

				{row.status === "DRAFTING" && !row.draft ? (
					<Alert>
						<AlertTitle className="flex items-center gap-2">
							<Spinner /> The agent is reading the history and writing a draft
						</AlertTitle>
						<AlertDescription>
							This usually takes under a minute. You can also write it yourself
							below.
						</AlertDescription>
					</Alert>
				) : null}

				{row.draftError && !row.draft ? (
					<Alert variant="warning">
						<AlertTitle>No draft this time</AlertTitle>
						<AlertDescription>
							{row.draftError} Write it yourself below, or ask the agent again.
						</AlertDescription>
					</Alert>
				) : null}

				{row.status === "APPROVED" ? (
					<Alert>
						<AlertTitle>Approved and waiting to go out</AlertTitle>
						<AlertDescription>
							{mailbox
								? `Send it from ${where}. The CRM marks it sent when your mailbox shows it, and counts the reply when one arrives.`
								: "No mailbox is connected, so the CRM cannot see the send. Mark it as sent once it has gone."}
						</AlertDescription>
					</Alert>
				) : null}

				<FieldGroup>
					<Field>
						<FieldLabel>To</FieldLabel>
						<Input value={to} readOnly disabled />
						{to === "" ? (
							<FieldDescription>
								This contact has no email address, so nothing can be sent.
							</FieldDescription>
						) : null}
					</Field>
					<Field>
						<FieldLabel htmlFor={subjectId}>Subject</FieldLabel>
						<Input
							id={subjectId}
							value={subject}
							disabled={!draftEditable}
							onChange={(event) => setSubject(event.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={bodyId}>Message</FieldLabel>
						<Textarea
							id={bodyId}
							value={body}
							rows={12}
							disabled={!draftEditable}
							placeholder={
								row.status === "DRAFTING"
									? "The draft appears here when it is ready."
									: "Write the follow-up."
							}
							onChange={(event) => setBody(event.target.value)}
						/>
						{row.draft?.note ? (
							<FieldDescription>
								{row.draft.byAgent ? "From the agent: " : ""}
								{row.draft.note}
							</FieldDescription>
						) : null}
					</Field>
				</FieldGroup>
			</div>

			{editable ? (
				<SheetFooter className="flex-row flex-wrap justify-between">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" disabled={busy}>
								More
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem
								disabled={!ready || !draftEditable}
								onSelect={() => save.mutate({ id: row.id, subject, body })}
							>
								Save draft
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => void copy()}>
								Copy subject and message
							</DropdownMenuItem>
							{row.status === "OPEN" || row.status === "READY" ? (
								<DropdownMenuItem
									onSelect={() => redraft.mutate({ id: row.id })}
								>
									{row.draft
										? "Ask the agent for a new draft"
										: "Ask the agent to draft it"}
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem
								onSelect={() => markSent.mutate({ id: row.id })}
							>
								Mark as sent
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Snooze</DropdownMenuLabel>
							{SNOOZE_DAYS.map((days) => (
								<DropdownMenuItem
									key={days}
									onSelect={() => snooze.mutate({ id: row.id, days })}
								>
									{days} days
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Dismiss</DropdownMenuLabel>
							{(Object.keys(DISMISSAL_LABEL) as Dismissal[]).map((reason) => (
								<DropdownMenuItem
									key={reason}
									onSelect={() => dismiss.mutate({ id: row.id, reason })}
								>
									{DISMISSAL_LABEL[reason]}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>

					<div className="flex flex-wrap gap-2">
						{mailbox && row.signal.threadId ? (
							<Button
								disabled={busy || !ready}
								onClick={() => void openEmail(row.status !== "APPROVED", true)}
							>
								{busy ? <Spinner data-icon="inline-start" /> : null}
								{row.status === "APPROVED"
									? "Open reply draft"
									: "Approve and open reply draft"}
							</Button>
						) : null}
						<Button
							variant={mailbox && row.signal.threadId ? "outline" : "default"}
							disabled={busy || !ready}
							onClick={() => void openEmail(row.status !== "APPROVED", false)}
						>
							{row.status === "APPROVED"
								? "Open new email"
								: "Approve and open new email"}
						</Button>
						{row.status === "APPROVED" ? (
							<Button
								disabled={busy}
								onClick={() => markSent.mutate({ id: row.id })}
							>
								Mark as sent
							</Button>
						) : null}
					</div>
				</SheetFooter>
			) : null}
		</>
	);
}

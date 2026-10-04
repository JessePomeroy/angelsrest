<script lang="ts">
import { type IntakeView, intakeFailureLabels, intakeRecoveryAllowed, intakeRecoveryLabels, intakeStateLabels, intakeViewUrl } from "$lib/commerceIntakeView";

let { view, message }: { view: IntakeView; message?: string } = $props();
const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
function date(value: number) { return `${formatter.format(value)} UTC`; }
const runbook = "https://github.com/JessePomeroy/angelsrest/blob/main/docs/runbooks/commerce-intake.md";
</script>

<section class="intake-view" aria-labelledby="intake-title">
	<a class="back-link" href="/admin/platform">Back to platform</a>
	<header>
		<h1 id="intake-title">Background intake</h1>
		<p>Review accepted checkout events, delayed attempts and work that needs attention.</p>
	</header>
	{#if view.status === "unauthorized"}
		<p role="alert">Sign in with platform creator access to review intake.</p>
	{:else}
		<form class="filters" method="GET" action="/admin/platform/intake">
			<label>Website<select name="site" value={view.siteUrl}>
				{#if !view.clients.some(client => client.siteUrl === view.siteUrl)}<option value={view.siteUrl}>{view.siteUrl}</option>{/if}
				{#each view.clients as client (client.siteUrl)}<option value={client.siteUrl}>{client.name}</option>{/each}
			</select></label>
			<label>State<select name="state" value={view.state}><option value="all">All states</option>
				{#each Object.entries(intakeStateLabels) as [value, label] (value)}<option {value}>{label}</option>{/each}
			</select></label>
			<button type="submit">Show events</button>
		</form>
		{#if message}<p class="feedback" role="status">{message}</p>{/if}
		{#if view.status === "unavailable"}
			<div class="empty"><h2>Intake status is unavailable</h2><p>Reload the page to try again. Saved events and scheduled attempts are retained.</p><a href={intakeViewUrl(view.siteUrl, view.state)}>Reload status</a></div>
		{:else}
			<div class="list-heading"><p>{view.siteUrl} · {view.state === "all" ? "All states" : intakeStateLabels[view.state]}</p><a href={intakeViewUrl(view.siteUrl, view.state, view.cursor)}>Refresh status</a></div>
			<p class="observed">Observed {date(view.observedAt)}. This view updates when refreshed.</p>
			{#if view.rows.length === 0}
				<div class="empty"><h2>No matching events</h2><p>Events appear after this website is approved for background intake and a checkout is accepted. Other checkouts continue through their existing flow.</p><a href={intakeViewUrl(view.siteUrl, "all")}>Show all states</a></div>
			{:else}
				<div class="events">
					{#each view.rows as row (row.inboxId)}
						<article aria-label={`${intakeStateLabels[row.state]} checkout ${row.stripeSessionId}`}>
							<div class="event-heading"><h2>{intakeStateLabels[row.state]}{row.overdue ? " · Overdue" : ""}</h2><span class="mode">{row.mode === "live" ? "Live mode" : "Test mode"}</span></div>
							<p class="identifier">{row.stripeSessionId}</p>
							{#if row.errorCode}<p class="reason">{intakeFailureLabels[row.errorCode]}</p>{/if}
							<dl class="facts"><div><dt>Accepted</dt><dd>{date(row.acceptedAt)}</dd></div><div><dt>Attempts</dt><dd>{row.attempts} total · {row.cycleAttempts} this cycle</dd></div><div><dt>{row.state === "processing" ? "Lease expires" : row.state === "done" ? "Completed" : "Next attempt"}</dt><dd>{row.state === "blocked" ? "Needs operator review" : row.state === "done" ? row.completedAt === null ? "Not recorded" : date(row.completedAt) : date(row.nextAt)}</dd></div></dl>
							<details><summary>Event details and recovery</summary><div class="details-body">
								<dl class="details-facts"><div><dt>Stripe event</dt><dd class="identifier">{row.stripeEventId}</dd></div><div><dt>Account</dt><dd class="identifier">{row.accountScope}</dd></div><div><dt>First claim</dt><dd>{row.firstClaimAt === null ? "Not yet claimed" : date(row.firstClaimAt)}</dd></div><div><dt>Operator recoveries</dt><dd>{row.recoveryCount}</dd></div><div><dt>Recorded order</dt><dd>{row.orderId ?? "Not recorded"}</dd></div></dl>
								{#if intakeRecoveryAllowed(row)}
									<p>Resolve the cause before scheduling another attempt. Recovery keeps existing payment, email and fulfillment safeguards.</p>
									{#if row.errorCode === "receipt_uncertain" || row.errorCode === "financial_recovery" || row.errorCode === "payload_invalid"}<p>Reconcile this evidence through the existing order or provider workflow. Only a check of saved completion evidence is available here.</p>{/if}
									<form class="recovery" method="POST" action={`?/recover&site=${encodeURIComponent(view.siteUrl)}&state=${view.state}`}>
										<input type="hidden" name="inboxId" value={row.inboxId} /><input type="hidden" name="siteUrl" value={row.siteUrl} /><input type="hidden" name="expectedVersion" value={row.version} />
										<label>Recovery reason<select name="reason" required><option value="">Choose a reason</option>{#each Object.entries(intakeRecoveryLabels) as [value, label] (value)}{#if value === "persisted_outcome_verified" || row.recoveryCount < 3 && row.errorCode !== "receipt_uncertain" && row.errorCode !== "financial_recovery" && row.errorCode !== "payload_invalid"}<option {value}>{label}</option>{/if}{/each}</select></label>
										<button type="submit">Apply recovery</button>
									</form>
								{:else if row.state === "done"}<p>Completion is recorded. Duplicate deliveries keep this saved result.</p>{:else}<p>A processing attempt is already scheduled. Refresh to see its next checkpoint.</p>{/if}
							</div></details>
						</article>
					{/each}
				</div>
			{/if}
			<nav class="pagination" aria-label="Intake event pages">{#if view.cursor}<a href={intakeViewUrl(view.siteUrl, view.state)}>First page</a>{/if}{#if view.nextCursor}<a href={intakeViewUrl(view.siteUrl, view.state, view.nextCursor)}>Next 25 events</a>{/if}</nav>
		{/if}
		<p class="footer"><a href={runbook}>Intake recovery runbook</a> · Completion confirms order intake, not print delivery.</p>
	{/if}
</section>

<style>
	.intake-view { max-width: 1200px; margin: 32px 40px; color: color-mix(in srgb, var(--admin-text) 80%, var(--admin-heading)); font-size: .9rem; line-height: 1.6; }
	header { margin: 20px 0 28px; } h1, h2, p, dl, dd { margin: 0; }
	h1, h2 { color: var(--admin-heading); font-family: var(--admin-font-display); font-weight: 500; line-height: 1.4; }
	h1 { font-size: 1.65rem; margin-bottom: 8px; } h2 { font-size: 1.05rem; }
	p { max-width: 72ch; } a { color: var(--admin-heading); text-underline-offset: 3px; overflow-wrap: anywhere; } a:hover { text-decoration-thickness: 2px; }
	.filters, .recovery { display: flex; gap: 16px; align-items: end; flex-wrap: wrap; }
	.filters { padding: 22px 0; border-block: 1px solid var(--admin-border-strong); } label { display: grid; gap: 6px; color: var(--admin-heading); font-size: .82rem; font-weight: 600; min-width: 0; }
	.filters label:first-child { flex: 1 1 260px; } .filters label:nth-child(2) { flex: 1 1 190px; }
	select, button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--admin-control-edge); border-radius: 6px; color: var(--admin-heading); background: var(--admin-control-bg); font: inherit; }
	select { width: 100%; text-overflow: ellipsis; } button { cursor: pointer; font-size: .86rem; } button:hover, select:hover { border-color: var(--admin-heading); } button:active { background: var(--admin-control-hover); }
	:is(a, select, button, summary):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 3px; }
	::selection { background: var(--admin-accent); color: var(--admin-bg); }
	.feedback { padding: 18px 0; color: var(--admin-heading); } .list-heading { display: flex; gap: 12px 24px; justify-content: space-between; flex-wrap: wrap; margin-top: 26px; color: var(--admin-heading); } .list-heading p { overflow-wrap: anywhere; }
	.observed, .footer { margin-top: 8px; color: var(--admin-text-muted); font-size: .8rem; }
	.empty { display: grid; gap: 10px; margin-block: 32px; }
	.events { margin-top: 22px; border-top: 1px solid var(--admin-border); } article { padding: 24px 0; border-bottom: 1px solid var(--admin-border); }
	.event-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; } .mode { font-size: .8rem; }
	.identifier { font-family: var(--admin-font-mono); font-size: .8rem; text-transform: none; overflow-wrap: anywhere; }
	.reason { margin-top: 12px; } .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; margin-top: 20px; }
	dt { color: var(--admin-heading); font-size: .8rem; font-weight: 600; } dd { margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	details { margin-top: 20px; } summary { min-height: 44px; width: fit-content; cursor: pointer; color: var(--admin-heading); } summary:hover { text-decoration: underline; text-underline-offset: 3px; }
	.details-body { display: grid; gap: 18px; } .details-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; } .recovery label { flex: 0 1 390px; }
	.pagination { display: flex; justify-content: space-between; gap: 20px; margin-top: 20px; } .pagination a { min-height: 44px; }
	.footer { margin-top: 24px; }
	@media (max-width: 850px) { .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 600px) { .intake-view { margin: 24px 16px; } .facts, .details-facts { grid-template-columns: 1fr; } .recovery { align-items: stretch; flex-direction: column; } .recovery label { flex-basis: auto; } .filters button { width: 100%; } }
</style>

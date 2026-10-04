<script lang="ts">
import type { FunctionReturnType } from "convex/server";
import type { api } from "$convex/api";

type ReleaseView = FunctionReturnType<typeof api.platformReleaseRecords.forSite>;
type Summary = ReleaseView["environments"][number]["summary"];

let {
	clients,
	selectedSiteUrl,
	onselect,
	result,
	loading = false,
	unavailable = false,
}: {
	clients: { name: string; siteUrl: string }[];
	selectedSiteUrl: string;
	onselect: (siteUrl: string) => void;
	result?: ReleaseView;
	loading?: boolean;
	unavailable?: boolean;
} = $props();

const runbook = "https://github.com/JessePomeroy/angelsrest/blob/main/docs/runbooks/package-release-and-adoption.md#platform-release-status";
const nextActions = {
	"record-deployment": "Record the current deployment and its verification.",
	"investigate-release": "Investigate the failed release before adopting another update.",
	"complete-verification": "Complete the required checks for this deployment.",
	"record-intent": "Record the reviewed release this website should run.",
	"align-release": "Review the difference from the intended release.",
	"verify-runtime": "Verify the required backend and Worker contracts.",
} satisfies Record<Summary["nextAction"], string>;
const outcomeLabels = { passed: "Passed", failed: "Failed", blocked: "Blocked", unknown: "Not recorded" };
const packageLabels = new Map([
	["@jessepomeroy/admin", "Admin"],
	["@jessepomeroy/crm-api", "CRM API"],
	["@jessepomeroy/gallery-delivery", "Gallery delivery"],
	["@jessepomeroy/print-catalog", "Print catalog"],
]);
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

let matching = $derived(result?.siteUrl === selectedSiteUrl ? result : undefined);
let pending = $derived(!unavailable && selectedSiteUrl !== "" && (loading || !matching));

function date(value: string) { return `${dateFormat.format(new Date(value))} UTC`; }
function sourceLink(repository: string, revision: string) { return `https://github.com/${repository}/commit/${revision}`; }
function checkLabel(id: string) {
	if (id === "http:/") return "Home page response";
	if (id === "http:/cart") return "Cart page response";
	return id;
}
function statusLabel(summary: Summary) {
	if (summary.currentHealth === "failed" || summary.nextAction === "investigate-release") return "Release needs attention";
	if (summary.currentHealth === "healthy") return "Required checks passed";
	if (summary.verification.status === "blocked") return "Verification blocked";
	return "Verification incomplete";
}
</script>

<section class="release-panel" aria-labelledby="release-status-heading" aria-busy={pending}>
	<div class="panel-heading">
		<div>
			<h2 id="release-status-heading">Release status</h2>
			<p>Compare the intended release with the last observed deployment.</p>
		</div>
		<div class="site-control">
			<label for="release-website">Website</label>
			<select id="release-website" value={selectedSiteUrl} onchange={(event) => onselect(event.currentTarget.value)} disabled={clients.length === 0}>
				{#if !selectedSiteUrl}<option value="">Choose a website</option>{/if}
				{#if selectedSiteUrl && !clients.some(client => client.siteUrl === selectedSiteUrl)}<option value={selectedSiteUrl}>{selectedSiteUrl}</option>{/if}
				{#each clients as client (client.siteUrl)}<option value={client.siteUrl}>{client.name}</option>{/each}
			</select>
		</div>
	</div>

	{#if unavailable}
		<div class="empty-state" role="alert">
			<h3>Release status is unavailable</h3>
			<p>Reload the page to try again. Previously saved evidence is retained.</p>
			<button type="button" onclick={() => window.location.reload()}>Reload page</button>
		</div>
	{:else if pending}
		<div class="loading-state" role="status">
			<p>Loading release evidence…</p>
			<div class="loading-lines" aria-hidden="true"><span></span><span></span><span></span></div>
		</div>
	{:else if !selectedSiteUrl}
		<p class="empty-state">Choose a website to inspect its recorded releases.</p>
	{:else if !matching?.environments.length}
		<div class="empty-state">
			<h3>No release evidence recorded</h3>
			<p>Record a reviewed release intent, then import the deployment and verification evidence for this website.</p>
			<a href={runbook}>Open the release runbook</a>
		</div>
	{:else}
		{#each matching.environments as environment (environment.target.environmentId)}
			{@const summary = environment.summary}
			<article class="environment" aria-label={`${environment.target.environmentId} release`}>
				<div class="environment-heading">
					<h3>{environment.target.environmentId.replaceAll("-", " ")}</h3>
					<p class="state" data-state={summary.nextAction === "investigate-release" ? "failed" : summary.currentHealth}>{statusLabel(summary)}</p>
				</div>
				<dl class="release-facts">
					<div>
						<dt>Intended release</dt>
						<dd>
							{#if summary.intended}
								<ul class="packages">{#each summary.intended.packages as item (item.name)}<li><span>{packageLabels.get(item.name) ?? item.name}</span><span>{item.version}</span></li>{/each}</ul>
								{#if summary.intended.sourceRevision}<a class="revision" href={sourceLink(environment.target.repository, summary.intended.sourceRevision)} title={summary.intended.sourceRevision}>{summary.intended.sourceRevision.slice(0, 12)}</a>{/if}
							{:else}<p>No reviewed intent recorded.</p>{/if}
						</dd>
					</div>
					<div>
						<dt>Observed deployment</dt>
						<dd>
							{#if summary.currentDeployment}
								<a class="revision" href={sourceLink(environment.target.repository, summary.currentDeployment.sourceRevision)} title={summary.currentDeployment.sourceRevision}>{summary.currentDeployment.sourceRevision.slice(0, 12)}</a>
								{#if summary.currentBuild}<ul class="packages">{#each summary.currentBuild.packages as item (item.name)}<li><span>{packageLabels.get(item.name) ?? item.name}</span><span>{item.version}</span></li>{/each}</ul>{:else}<p>Linked build not recorded.</p>{/if}
								<p class="note"><time datetime={summary.currentDeployment.observedAt}>{date(summary.currentDeployment.observedAt)}</time></p>
							{:else}<p>Current deployment unknown.</p>{/if}
						</dd>
					</div>
					<div>
						<dt>Required verification</dt>
						<dd>
							<ul class="checks">{#each summary.verification.checks as check (`${check.scope}:${check.id}`)}<li><span>{checkLabel(check.id)}<small>{check.scope}</small></span><span>{outcomeLabels[check.result]}</span></li>{/each}</ul>
						</dd>
					</div>
				</dl>
				<div class="compatibility">
					<strong>Compatibility</strong>
					<p>{summary.compatibility.versions === "match" ? "Requested package versions match." : summary.compatibility.versions === "mismatch" ? "Package versions differ from the intended release." : "Package comparison is not yet available."} Runtime compatibility is unverified.</p>
					{#if summary.compatibility.source === "mismatch" || summary.compatibility.contract === "mismatch"}<p>The observed source or integration contract differs from the reviewed intent.</p>{/if}
				</div>
				<div class="next-action"><strong>Next action</strong><p>{nextActions[summary.nextAction]}</p></div>
				<details>
					<summary>Evidence and recovery reference</summary>
					<div class="evidence-details">
						{#if summary.lastHealthy}
							<p><strong>Last release passing these checks:</strong> <a class="revision" href={sourceLink(environment.target.repository, summary.lastHealthy.sourceRevision)}>{summary.lastHealthy.sourceRevision.slice(0, 12)}</a>, observed {date(summary.lastHealthy.observedAt)}.</p>
							<p class="identifier">{summary.lastHealthy.deploymentId}</p>
						{:else}<p>No release has a complete passing record for these checks.</p>{/if}
						{#if summary.latestDeployment && summary.latestDeployment.deploymentId !== summary.currentDeployment?.deploymentId}<p>Latest observed attempt: <span class="identifier">{summary.latestDeployment.deploymentId}</span> ({summary.latestDeployment.status}).</p>{/if}
						{#if summary.currentDeployment}<p>Deployment source is associated with its CI build. {summary.configurationObserved ? "A runtime configuration observation is recorded." : "Runtime configuration has not been observed."}</p>{/if}
						{#if summary.currentBuild?.scope === "ci-fixture"}<p>The CI build used fixture configuration.</p>{/if}
						<p>{summary.capabilitiesObserved ? "A capability observation is recorded." : "Capability activation has not been observed."}</p>
						<p>Verification covers the named checks at their recorded time.</p>
					</div>
				</details>
			</article>
		{/each}
		<p class="panel-footer">Updated when operator evidence is imported. <a href={runbook}>Release runbook</a></p>
	{/if}
</section>

<style>
	.release-panel { max-width: 1200px; margin: 32px 40px 0; padding: 24px; border: 1px solid var(--admin-border); border-radius: 8px; background: var(--admin-surface); color: color-mix(in srgb, var(--admin-text) 80%, var(--admin-heading)); font-size: .9rem; line-height: 1.6; }
	.panel-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
	h2, h3, p, dl, dd { margin: 0; }
	h2 { color: var(--admin-heading); font-family: var(--admin-font-display); font-size: 1.25rem; font-weight: 500; line-height: 1.4; }
	h3 { color: var(--admin-heading); font-family: var(--admin-font-display); font-size: 1rem; font-weight: 600; line-height: 1.5; }
	p { max-width: 72ch; }
	.panel-heading p { margin-top: 6px; color: var(--admin-text-muted); }
	.site-control { display: grid; gap: 6px; width: min(100%, 280px); flex-shrink: 0; }
	label, dt { color: var(--admin-heading); font-size: .82rem; font-weight: 600; }
	select, button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--admin-control-edge); border-radius: 6px; color: var(--admin-heading); background: var(--admin-control-bg); font: inherit; }
	select { width: 100%; text-overflow: ellipsis; }
	button { width: fit-content; cursor: pointer; }
	select:hover:not(:disabled), button:hover { border-color: var(--admin-heading); }
	select:disabled { opacity: .6; }
	button:active { background: var(--admin-control-hover); }
	:is(a, select, button, summary):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 3px; }
	a { color: var(--admin-heading); text-underline-offset: 3px; overflow-wrap: anywhere; }
	a:hover { text-decoration-thickness: 2px; }
	::selection { background: var(--admin-accent); color: var(--admin-bg); }
	.environment { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--admin-border-strong); }
	.environment-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; }
	.environment-heading h3 { overflow-wrap: anywhere; }
	.state { display: flex; align-items: center; gap: 8px; color: var(--admin-heading); font-size: .82rem; }
	.state::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--status-slate); flex: none; }
	.state[data-state="healthy"]::before { background: var(--status-sage); }
	.state[data-state="failed"]::before { background: var(--status-rose); }
	.state[data-state="blocked"]::before { background: var(--status-amber); }
	.release-facts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.15fr); gap: 24px; margin-top: 22px; }
	.release-facts > div { min-width: 0; }
	dd { margin-top: 8px; }
	.revision, .identifier { text-transform: none; font-family: var(--admin-font-mono); font-size: .8rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.packages, .checks { display: grid; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
	.packages li, .checks li { display: flex; justify-content: space-between; gap: 12px; }
	.packages span, .checks span { min-width: 0; overflow-wrap: anywhere; }
	.packages li > :last-child { font-variant-numeric: tabular-nums; }
	.checks small { display: block; color: var(--admin-text-muted); font-size: .75rem; }
	.checks li + li { margin-top: 5px; }
	.note { margin-top: 8px; color: var(--admin-text-muted); font-size: .78rem; }
	.compatibility, .next-action { display: grid; grid-template-columns: 135px minmax(0, 1fr); gap: 4px 20px; margin-top: 22px; }
	.compatibility strong, .next-action strong { color: var(--admin-heading); font-size: .82rem; }
	.compatibility > p + p { grid-column: 2; }
	.next-action { margin-top: 14px; }
	details { margin-top: 22px; border-top: 1px solid var(--admin-border); padding-top: 14px; }
	summary { width: fit-content; color: var(--admin-heading); cursor: pointer; min-height: 44px; }
	summary:hover { text-decoration: underline; text-underline-offset: 3px; }
	.evidence-details { display: grid; gap: 8px; padding-top: 8px; color: var(--admin-text-muted); font-size: .82rem; }
	.evidence-details strong { color: var(--admin-heading); }
	.empty-state, .loading-state { display: grid; gap: 10px; margin-top: 26px; padding-top: 24px; border-top: 1px solid var(--admin-border); }
	.loading-lines { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 8px; }
	.loading-lines span { display: block; height: 60px; background: var(--admin-surface-raised); border-radius: 3px; }
	.panel-footer { margin-top: 22px; color: var(--admin-text-muted); font-size: .8rem; }
	@media (max-width: 1080px) { .release-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } .release-facts > :last-child { grid-column: 1 / -1; max-width: 420px; } }
	@media (max-width: 700px) { .release-panel { margin: 24px 16px 0; padding: 20px; } .panel-heading { align-items: stretch; flex-direction: column; gap: 20px; } .site-control { width: 100%; } .release-facts { grid-template-columns: 1fr; gap: 20px; } .compatibility, .next-action { grid-template-columns: 1fr; gap: 4px; } .compatibility > p + p { grid-column: 1; } .loading-lines { grid-template-columns: 1fr; gap: 12px; } .loading-lines span { height: 40px; } }
</style>

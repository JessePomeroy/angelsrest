<script lang="ts">
import { AdminLayout, setAdminConfig } from "@jessepomeroy/admin";
import type { ComponentProps } from "svelte";
import PlatformReleaseStatus from "../../../src/lib/components/PlatformReleaseStatus.svelte";
import { adminConfig } from "../../../src/lib/config/admin";
import { siteSettings } from "../handbook/public-data";

type View = NonNullable<ComponentProps<typeof PlatformReleaseStatus>["result"]>;
const scenario = new URLSearchParams(window.location.search).get("state") ?? "recorded";
setAdminConfig({ ...adminConfig, api: { ...adminConfig.api, notifications: undefined } });
const data = { siteSettings, adminSession: { status: "authorized" as const, email: "operator@example.invalid", tier: "full" as const, isCreator: true }, newInquiryCount: 0 };
const clients = [{ name: "Cedar Finch — synthetic fixture", siteUrl: "cedar.example" }, { name: "Willow Studio — synthetic fixture", siteUrl: "willow.example" }];
const observedAt = "2026-01-02T12:30:00.000Z";
const deployment = { recordId: `sha256:${"c".repeat(64)}`, deploymentId: "dpl_syntheticCedar", sourceRevision: "a".repeat(40), url: "https://fixture.vercel.app", status: "READY" as const, observedAt };
const packages = [{ name: "@jessepomeroy/admin", version: "6.7.1" }, { name: "@jessepomeroy/crm-api", version: "6.6.0" }];
const recorded: View = {
	siteUrl: "cedar.example",
	environments: [{
		target: { repository: "fixture/cedar", siteUrl: "cedar.example", environmentId: "production", publicOrigin: "https://cedar.example", requiredChecks: [{ id: "http:/", scope: "public" }, { id: "http:/cart", scope: "public" }] },
		summary: {
			observedAt,
			intended: scenario === "unknown" ? null : { recordId: `sha256:${"d".repeat(64)}`, sourceRevision: deployment.sourceRevision, packages, reviewRef: "https://github.com/fixture/cedar/pull/1" },
			currentDeployment: scenario === "unknown" ? null : deployment,
			latestDeployment: scenario === "unknown" ? null : deployment,
			lastHealthy: scenario === "unknown" ? null : deployment,
			currentBuild: scenario === "unknown" ? null : { recordId: `sha256:${"b".repeat(64)}`, packages, scope: "ci-fixture" },
			currentHealth: scenario === "unknown" ? "unknown" : "healthy",
			verification: { status: scenario === "unknown" ? "unknown" : "passed", checks: ["http:/", "http:/cart"].map(id => ({ id, scope: "public", result: scenario === "unknown" ? "unknown" : "passed", observedAt: scenario === "unknown" ? null : observedAt, evidenceRef: scenario === "unknown" ? null : "docs/synthetic.json" })) },
			compatibility: { versions: scenario === "unknown" ? "unknown" : "match", source: scenario === "unknown" ? "unknown" : "match", contract: "unknown", runtime: "unknown" },
			configurationObserved: false, capabilitiesObserved: false, nextAction: scenario === "unknown" ? "record-deployment" : "verify-runtime",
		},
	}],
};
if (scenario === "failed") {
	const summary = recorded.environments[0].summary;
	summary.currentDeployment = { ...deployment, deploymentId: "dpl_syntheticFailedUpgrade", sourceRevision: "f".repeat(40), status: "ERROR" };
	summary.latestDeployment = summary.currentDeployment;
	summary.currentHealth = "failed";
	summary.verification.status = "failed";
	summary.verification.checks[1].result = "failed";
	summary.nextAction = "investigate-release";
}

let selectedSiteUrl = $state("cedar.example");
let result = $state<View | undefined>(scenario === "loading" ? undefined : scenario === "empty" ? { siteUrl: "cedar.example", environments: [] } : recorded);
function select(siteUrl: string) {
	selectedSiteUrl = siteUrl;
	if (scenario !== "stale") result = siteUrl === "cedar.example" ? recorded : { siteUrl, environments: [] };
}
</script>

<AdminLayout {data}>
	<PlatformReleaseStatus {clients} {selectedSiteUrl} onselect={select} {result} loading={scenario === "loading"} unavailable={scenario === "error"} />
	{#if scenario === "stale"}<button type="button" onclick={() => { result = { siteUrl: selectedSiteUrl, environments: [] }; }}>Complete delayed response</button>{/if}
	<p class="fixture-note">Synthetic release evidence for browser verification.</p>
</AdminLayout>

<style>.fixture-note { margin: 24px 40px; color: var(--admin-text-muted); font-size: .8rem; }</style>

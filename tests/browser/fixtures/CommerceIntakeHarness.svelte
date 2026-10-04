<script lang="ts">
import { AdminLayout, setAdminConfig } from "@jessepomeroy/admin";
import CommerceIntakeStatus from "../../../src/lib/components/CommerceIntakeStatus.svelte";
import type { IntakeRow, IntakeView } from "../../../src/lib/commerceIntakeView";
import { adminConfig } from "../../../src/lib/config/admin";
import { siteSettings } from "../handbook/public-data";

setAdminConfig({ ...adminConfig, api: { ...adminConfig.api, notifications: undefined } });
const scenario = new URLSearchParams(window.location.search).get("state") ?? "blocked";
const data = { siteSettings, adminSession: { status: "authorized" as const, email: "operator@example.invalid", tier: "full" as const, isCreator: true }, newInquiryCount: 0 };
const now = Date.parse("2026-01-02T12:30:00Z");
const row: IntakeRow = {
	inboxId: "j1234567890123456789012345678901" as IntakeRow["inboxId"], version: 8, protocolVersion: 1,
	siteUrl: "cedar.example", tenantId: null, mode: "test", accountScope: "platform",
	stripeEventId: "evt_syntheticCedar1234567890", stripeSessionId: "cs_test_syntheticCedar12345678901234567890",
	state: "blocked", acceptedAt: now - 3600000, firstClaimAt: now - 3590000, lastClaimAt: now - 300000,
	nextAt: now - 200000, leaseExpiresAt: null, attempts: 12, cycleAttempts: 12, recoveryCount: 0,
	errorCode: "attempts_exhausted", lastAttemptCode: "processing_failed", orderId: null,
	completedAt: null, blockedAt: now - 300000, completion: null, overdue: false,
};
if (scenario === "uncertain") row.errorCode = "receipt_uncertain";
if (scenario === "done") Object.assign(row, { state: "done", errorCode: null, completedAt: now - 100000, completion: "order_intake" });
if (scenario === "processing") Object.assign(row, { state: "processing", errorCode: null, nextAt: now + 90000, leaseExpiresAt: now + 90000 });
if (scenario === "overdue") Object.assign(row, { state: "pending", errorCode: null, nextAt: now - 600000, overdue: true });
const view: IntakeView = {
	status: scenario === "error" ? "unavailable" : scenario === "unauthorized" ? "unauthorized" : "ready",
	siteUrl: "cedar.example", state: "all", clients: [{ name: "Cedar Finch — synthetic fixture", siteUrl: "cedar.example" }, { name: "Willow Studio — synthetic fixture", siteUrl: "willow.example" }],
	rows: scenario === "empty" ? [] : [row], cursor: null, nextCursor: scenario === "blocked" ? "synthetic-next" : null, observedAt: now,
};
</script>
<AdminLayout {data}>
	<CommerceIntakeStatus {view} message={scenario === "feedback" ? "Another processing attempt is scheduled." : undefined} />
	<p class="fixture-note">Synthetic intake records for browser verification.</p>
</AdminLayout>
<style>.fixture-note { margin: 24px 40px; color: var(--admin-text-muted); font-size: .8rem; }</style>

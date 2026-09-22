<script lang="ts">
import ClientPrintRefundPage from "../../../src/lib/components/ClientPrintRefundPage.svelte";
import type { ClientPrintRefundPageData } from "../../../src/lib/clientPrintRefunds";
import type { Id } from "../../../packages/crm-api/convex/_generated/dataModel";
const phase = new URLSearchParams(window.location.search).get("phase") ?? "new";
const orderId = "fixture_order" as Id<"orders">;
const operationId = "fixture_refund" as Id<"clientPrintRefundOperations">;
const state = phase === "pending" ? "customer_pending" : phase === "complete" ? "complete" : "attention";
const existing = ["pending", "complete", "attention"].includes(phase);
const data: ClientPrintRefundPageData = {
	siteUrl: "studio.example.invalid", enabled: phase !== "disabled", requestToken: "123e4567-e89b-42d3-a456-426614174000",
	page: { siteUrl: "studio.example.invalid", orders: [{ id: orderId, orderNumber: "ORD-001", total: 14000, createdAt: 1800000000000 }], selected: {
		id: orderId, orderNumber: "ORD-001", total: 14000, status: "new", supplierReviewRequired: false, supplierOrderExists: true,
		lines: [{ index: 0, name: "Woodland print", kind: "print", originalCents: 10000, remainingCents: existing ? 6000 : 10000 }, { index: 1, name: "Digital download", kind: "digital_download", originalCents: 3000, remainingCents: 3000 }], otherRemainingCents: 1000, printRefundedCents: existing ? 4000 : 0, feeReturnedCents: existing ? 200 : 0,
		activeOperationId: existing && state !== "complete" ? operationId : null,
		operations: existing ? [{ id: operationId, state, amountCents: 4000, printAmountCents: 4000, feeAmountCents: 200, customerStatus: phase === "pending" ? "pending" : "succeeded", customerRefundId: "re_fixture", feeRefundId: state === "complete" ? "fr_fixture" : null, issue: state === "attention" ? "provider_unavailable" : null, updatedAt: 1800000000000, canCancel: false }] : [],
	} },
};
</script>
<ClientPrintRefundPage {data} form={phase === "error" ? { message: "Refresh the order to check any existing refund before trying again." } : null} />

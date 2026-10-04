import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "$convex/api";

export type IntakeRow = FunctionReturnType<typeof api.commerceIntakeInbox.list>["page"][number];
export type IntakeState = IntakeRow["state"];
export type IntakeRecoveryReason = FunctionArgs<typeof api.commerceIntakeInbox.recover>["reason"];
export type IntakeView = {
	status: "ready" | "unavailable" | "unauthorized";
	siteUrl: string;
	state: IntakeState | "all";
	clients: { siteUrl: string; name: string }[];
	rows: IntakeRow[];
	cursor: string | null;
	nextCursor: string | null;
	observedAt: number;
};
export const intakeStateLabels = {
	pending: "Waiting",
	processing: "Processing",
	retry: "Retry scheduled",
	blocked: "Needs attention",
	done: "Complete",
} satisfies Record<IntakeState, string>;
export const intakeFailureLabels = {
	runner_unavailable: "The runner did not complete this attempt.",
	processing_failed: "Order processing needs another attempt.",
	payload_invalid: "Stored event evidence needs investigation.",
	scope_conflict: "Payment account, mode or website evidence does not match.",
	missing_order: "Processing returned without a recorded order.",
	receipt_pending: "A payment receipt is still awaiting acceptance.",
	receipt_uncertain: "Receipt delivery is uncertain. Reconcile delivery before taking action.",
	handoff_unproven: "The order has no confirmed intake or fulfillment handoff.",
	financial_recovery: "Resolve the order’s financial or cancellation state first.",
	attempts_exhausted: "Automatic attempts have reached their limit.",
	age_exceeded: "The automatic retry period has ended.",
} satisfies Record<NonNullable<IntakeRow["errorCode"]>, string>;
export const intakeRecoveryLabels = {
	dependencies_restored: "A service connection is restored",
	input_repaired: "Missing order information is repaired",
	routing_restored: "Website and payment routing are repaired",
	schedule_restored: "A missing scheduled attempt is repaired",
	persisted_outcome_verified: "Check the saved completion evidence",
} satisfies Record<IntakeRecoveryReason, string>;

export function intakeRecoveryAllowed(row: IntakeRow) {
	return (row.state === "blocked" || row.overdue) && row.state !== "done";
}

export function intakeViewUrl(
	siteUrl: string,
	state: IntakeView["state"],
	cursor: string | null = null,
) {
	const search = new URLSearchParams({ site: siteUrl, state });
	if (cursor) search.set("cursor", cursor);
	return `/admin/platform/intake?${search}`;
}

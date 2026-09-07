<script lang="ts">
import type { FunctionReturnType } from "convex/server";
import type { api } from "$convex/api";
import { page } from "$app/state";
import TurnstileWidget from "$lib/components/TurnstileWidget.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import { formatCents } from "$lib/utils/format";

type CustomerOrder = NonNullable<FunctionReturnType<typeof api.orders.lookupForCustomer>>;

let email = $state("");
let orderNumber = $state(page.url.searchParams.get("order") || "");
let loading = $state(false);
let error = $state("");
let verificationError = $state("");
let verificationReady = $state(false);
let order = $state<CustomerOrder | null>(null);
let turnstileWidget: TurnstileWidget | undefined;

function resetTurnstile() {
	verificationReady = false;
	turnstileWidget?.reset();
}

async function lookupOrder(form: HTMLFormElement) {
	if (loading) return;
	if (!email || !orderNumber) {
		error = "Please enter both email and order number";
		return;
	}
	const turnstileToken = new FormData(form).get("cf-turnstile-response");
	if (typeof turnstileToken !== "string" || turnstileToken.length === 0) {
		error = "Please complete the verification challenge";
		return;
	}

	loading = true;
	error = "";
	order = null;

	try {
		// Audit H34: use POST so email is not written to access logs.
		const response = await fetch("/api/orders/lookup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email,
				orderNumber,
				"cf-turnstile-response": turnstileToken,
			}),
		});
		const data: { order?: CustomerOrder; error?: string } = await response.json();

		if (response.ok && data.order) {
			order = data.order;
		} else {
			error = data.error || "Order not found";
		}
	} catch (err) {
		console.error("orders lookup failed", err);
		error = "Failed to look up order";
		toasts.show("Failed to look up order. Please try again.", { type: "error" });
	} finally {
		loading = false;
		resetTurnstile();
	}
}

function handleSubmit(event: SubmitEvent) {
	event.preventDefault();
	void lookupOrder(event.currentTarget as HTMLFormElement);
}

const statusLabels: Record<string, string> = {
	new: "New",
	printing: "Printing",
	ready: "Ready",
	shipped: "Shipped",
	delivered: "Delivered",
	refunded: "Refunded",
};

</script>

<svelte:head>
	<title>Track Order | Angel's Rest</title>
</svelte:head>

<div class="orders-page">
	<div class="lookup-content">
		<a href="/" class="home-link">← Angel's Rest</a>
		
		<h1 class="page-title">Track Your Order</h1>
		<p class="intro">Enter your order details to check the status</p>

		<form class="lookup-form" onsubmit={handleSubmit}>
			<div>
				<label for="email" class="field-label">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					class="lookup-input"
					required
				/>
			</div>

			<div>
				<label for="order" class="field-label">Order Number</label>
				<input
					id="order"
					type="text"
					bind:value={orderNumber}
					placeholder="ORD-001"
					class="lookup-input"
					required
				/>
			</div>

				<TurnstileWidget
					bind:this={turnstileWidget}
					theme="dark"
					onverified={() => {
						verificationReady = true;
						verificationError = "";
					}}
					onerror={() => {
						verificationReady = false;
						verificationError = "Verification could not load. Please try again.";
					}}
					onexpired={() => {
						verificationError = "Verification expired. Please complete it again.";
						resetTurnstile();
					}}
					onloaderror={(error) => {
						console.error("orders Turnstile failed to load", error);
						verificationReady = false;
						verificationError = "Verification could not load. Please refresh and try again.";
					}}
				/>

				<button
					type="submit"
					disabled={loading || !verificationReady}
				class="lookup-button"
			>
				{loading ? 'Looking up...' : 'Track Order'}
			</button>

				<div aria-live="polite">
					{#if verificationError}
						<p class="lookup-error">{verificationError}</p>
					{/if}
					{#if error}
					<p class="lookup-error">{error}</p>
				{/if}
			</div>
		</form>

		<div aria-live="polite">
		{#if order}
			<div class="order-result">
				<div class="result-header">
					<div>
						<h2 class="order-number">{order.orderNumber}</h2>
					</div>
					<span class="status-badge" data-status={order.status}>
						{statusLabels[order.status] || order.status}
					</span>
				</div>

				<div class="order-details">
					<h3 class="items-heading">Items</h3>
					<ul class="items-list">
						{#each order.items || [] as item, i (i)}
							<li class="item-row">
								<span>{item.productName} × {item.quantity}</span>
								<span class="item-price">{formatCents(item.price)}</span>
							</li>
						{/each}
					</ul>
					<p class="order-total">
						Total: {formatCents(order.total)}
					</p>
				</div>

			</div>
		{/if}
		</div>
	</div>
</div>

<style>
  @layer components {
    .orders-page { min-height: 100vh; color: white; padding: 1rem; }
    .lookup-content { max-width: 28rem; margin-inline: auto; }
    .home-link { font-size: var(--text-lg); line-height: var(--text-lg--line-height); font-weight: 700; }
    @media (hover: hover) { .home-link:hover { color: oklch(87.2% 0.01 258.338); } }
    .page-title { font-size: var(--text-xl); }
    .intro { color: oklch(70.7% 0.022 261.325); font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .lookup-form > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 0.75rem; }
    .lookup-form { border-radius: 0.5rem; padding: 1rem; }
    .field-label { display: block; font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: oklch(70.7% 0.022 261.325); margin-bottom: 0.25rem; }
    .lookup-input { width: 100%; padding-inline: 0.75rem; padding-block: 0.5rem; background-color: oklch(21% 0.034 264.665); border: 1px solid; border-color: oklch(37.3% 0.034 259.733); border-radius: 0.25rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .lookup-button { width: 100%; padding-block: 0.5rem; background-color: oklch(54.6% 0.245 262.881); border-radius: 0.25rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-weight: 500; }
    @media (hover: hover) { .lookup-button:hover { background-color: oklch(48.8% 0.243 264.376); } }
    .lookup-button:disabled { background-color: oklch(44.6% 0.03 256.802); }
    .lookup-error { color: oklch(70.4% 0.191 22.216); font-size: var(--text-sm); line-height: var(--text-sm--line-height); text-align: center; }
    .order-result { margin-top: 1rem; border-radius: 0.5rem; padding: 1rem; }
    .result-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
    .order-number { font-size: var(--text-lg); }
    .status-badge { padding-inline: 0.5rem; padding-block: 0.25rem; border-radius: 0.25rem; font-size: var(--text-xs); line-height: var(--text-xs--line-height); font-weight: 500; background-color: oklch(44.6% 0.03 256.802); }
    .order-details { font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .items-heading { color: oklch(70.7% 0.022 261.325); font-size: var(--text-xs); }
    .items-list > :not(:last-child) { margin-block-start: 0; margin-block-end: 0.25rem; }
    .item-row { display: flex; justify-content: space-between; font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .item-price { color: oklch(70.7% 0.022 261.325); }
    .order-total { font-weight: 500; text-align: right; }
    .status-badge[data-status="new"] { background-color: oklch(54.6% 0.245 262.881); }
    .status-badge[data-status="printing"] { background-color: oklch(79.5% 0.184 86.047); color: black; }
    .status-badge[data-status="ready"] { background-color: oklch(79.5% 0.184 86.047); color: black; }
    .status-badge[data-status="shipped"] { background-color: oklch(55.8% 0.288 302.321); }
    .status-badge[data-status="delivered"] { background-color: oklch(62.7% 0.194 149.214); }
    .status-badge[data-status="refunded"] { background-color: oklch(57.7% 0.245 27.325); }
  }
</style>

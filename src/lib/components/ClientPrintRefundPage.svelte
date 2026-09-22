<script lang="ts">
import { untrack } from "svelte";
import { clientPrintRefundPath, refundCents, type ClientPrintRefundPageData } from "$lib/clientPrintRefunds";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";
let { data, form }: { data: ClientPrintRefundPageData; form?: { message: string } | null } = $props();
const order = $derived(data.page?.selected);
const path = $derived(clientPrintRefundPath(data.siteUrl));
let amounts = $state<string[]>(untrack(() => data.page?.selected?.lines.map(() => "0.00") ?? []));
let other = $state("0.00");
let confirmed = $state(false);
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const selectedCents = $derived(amounts.map(value => refundCents(value) ?? 0));
const printCents = $derived(order?.lines.reduce((sum, line) => sum + (["print", "print_set"].includes(line.kind) ? selectedCents[line.index] ?? 0 : 0), 0) ?? 0);
const total = $derived(selectedCents.reduce((sum, value) => sum + value, refundCents(other) ?? 0));
const fee = $derived(Math.max(0, Math.floor(((order?.printRefundedCents ?? 0) + printCents) / 20) - (order?.feeReturnedCents ?? 0)));
const blocked = $derived(order?.operations.some(operation => !["complete", "failed", "canceled"].includes(operation.state)));
const states = { checking: "Checking refund", customer_pending: "Waiting for Stripe", fee_pending: "Customer refunded · fee return pending", complete: "Complete", failed: "Customer refund failed", canceled: "Canceled", attention: "Needs a status check or Angels Rest review" };
</script>
<svelte:head><title>Print refunds · Angels Rest</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main data-admin>
	<div class="content">
		<a href={stripeConnectSetupPath(data.siteUrl)}>← Payment setup</a>
		<header><p class="eyebrow">{data.siteUrl}</p><h1>Print refunds</h1><p>Choose the amounts to return to your customer. Angels Rest returns its 5% fee on the refunded print amount only.</p></header>
		{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
		{#if !data.enabled}<section><h2>Refunds are being prepared</h2><p>Contact Angels Rest for help with a refund while setup is completed.</p></section>
		{:else}
			<form method="GET" action={path} class="selector">
				<label for="order">Recent orders</label>
				<select id="order" name="order" required value={order?.id ?? ""}><option value="" disabled>Choose an order</option>{#each data.page?.orders ?? [] as item}<option value={item.id}>{item.orderNumber} · {money(item.total)}</option>{/each}</select>
				<button type="submit">Open order</button>
			</form>
			{#if !data.page?.orders.length}<p>No eligible recent orders. Contact Angels Rest for help finding an older order.</p>{/if}
			{#if order}
				<section><h2>Order {order.orderNumber}</h2><p>Original payment: {money(order.total)}</p>
					{#if order.supplierReviewRequired}<p class="notice">Print fulfillment needs review. Contact Angels Rest about the supplier order before making further changes.</p>{/if}
					<p class="notice">A payment refund does not cancel or refund a LumaPrints order. {order.supplierOrderExists ? "This order has already been sent to LumaPrints." : "Check fulfillment before refunding."} Contact Angels Rest if supplier changes are needed.</p>
					{#if !blocked && order.status !== "refunded" && order.status !== "canceled"}
						<form method="POST" action={path}>
							<input type="hidden" name="intent" value="request" /><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="requestToken" value={data.requestToken} />
							<fieldset><legend>Amounts to refund</legend>
								{#each order.lines as line}<div class="amount-row"><label for={`line_${line.index}`}>{line.name}<small>{["print", "print_set"].includes(line.kind) ? "Print · 5% fee returned" : "No Angels Rest fee"} · {money(line.remainingCents)} available</small></label><input id={`line_${line.index}`} name={`line_${line.index}`} type="number" inputmode="decimal" min="0" max={(line.remainingCents / 100).toFixed(2)} step="0.01" required value={amounts[line.index]} oninput={event => { amounts[line.index] = event.currentTarget.value; }} aria-label={`Refund dollars for ${line.name}`} /></div>{/each}
								<div class="amount-row"><label for="other">Shipping, tax and other charges<small>No Angels Rest fee · {money(order.otherRemainingCents)} available</small></label><input id="other" name="other" type="number" inputmode="decimal" min="0" max={(order.otherRemainingCents / 100).toFixed(2)} step="0.01" required value={other} oninput={event => { other = event.currentTarget.value; }} /></div>
								<dl aria-live="polite"><div><dt>Customer receives</dt><dd>{money(total)}</dd></div><div><dt>Angels Rest fee returned to you</dt><dd>{money(fee)}</dd></div></dl>
								<p class="fine">The fee return is separate from the customer refund. Fractions of a cent carry across refunds on this order.</p>
								<label class="confirm"><input type="checkbox" name="confirmed" value="yes" required bind:checked={confirmed} />I confirm these amounts and understand that LumaPrints fulfillment is separate.</label>
								<button type="submit" disabled={!confirmed || total <= 0}>{`Refund ${money(total)}`}</button>
							</fieldset>
						</form>
					{:else if blocked}<p>Finish or resolve the existing refund before starting another.</p>{/if}
				</section>
				{#if order.operations.length}<section><h2>Refund activity</h2>{#each order.operations as operation}<article><h3>{states[operation.state]}</h3><p>Customer refund: {money(operation.amountCents)} · {operation.customerStatus ?? "not sent"}<br />Fee return: {money(operation.feeAmountCents)} · {operation.feeRefundId ? "returned" : operation.feeAmountCents === 0 ? "none due" : "not yet returned"}</p>
					{#if operation.issue}<p>Check the status again. If it still needs attention, contact Angels Rest before creating a refund directly in Stripe.</p>{/if}
					{#if order.activeOperationId === operation.id}<form method="POST" action={path} class="actions"><input type="hidden" name="operationId" value={operation.id} /><button name="intent" value="retry">Check and continue refund</button>{#if operation.canCancel}<button class="secondary" name="intent" value="cancel">Cancel request</button>{/if}</form>{/if}
				</article>{/each}</section>{/if}
			{/if}
		{/if}
		<footer><a href="/about">Contact Angels Rest</a></footer>
	</div>
</main>
<style>
main { min-height:100dvh; padding:clamp(24px,6vw,72px) 24px; background:var(--admin-bg); color:var(--admin-text); }
.content { max-width:680px; margin:auto; } header { margin:28px 0; } h1,h2,h3 { font-family:"Chillax",sans-serif; color:var(--admin-heading); font-weight:500; } h1 { font-size:clamp(2rem,5vw,2.7rem); margin:8px 0; } h2 { font-size:1.4rem; } h3 { font-size:1.1rem; } p { line-height:1.6; color:var(--admin-text-muted); } a { color:var(--admin-heading); text-underline-offset:4px; } .eyebrow,small,.fine { font-size:.85rem; color:var(--admin-text-muted); } .eyebrow { overflow-wrap:anywhere; } section { border-top:1px solid var(--admin-border); padding-block:24px; } .notice { padding:16px; background:var(--admin-surface); border-left:2px solid var(--admin-border-strong); } .selector { display:flex; flex-wrap:wrap; gap:12px; align-items:center; } .selector label { width:100%; } select { flex:1; min-width:0; } input:not([type="checkbox"]),select { min-height:44px; padding:8px 12px; border:1px solid var(--admin-border-strong); border-radius:4px; color:var(--admin-text); background:var(--admin-surface); font:inherit; } .amount-row { display:grid; grid-template-columns:1fr 120px; gap:16px; align-items:center; margin:20px 0; } .amount-row input { width:100%; box-sizing:border-box; } small { display:block; margin-top:6px; } fieldset { padding:0; margin:24px 0 0; border:0; min-width:0; } legend { font-weight:500; } dl { padding-block:16px; border-block:1px solid var(--admin-border); } dl div { display:flex; justify-content:space-between; gap:20px; margin:12px 0; } dd { margin:0; white-space:nowrap; } .confirm { display:flex; align-items:flex-start; gap:12px; line-height:1.6; margin:24px 0; } .confirm input { margin-top:6px; width:20px; height:20px; flex-shrink:0; } button { min-height:44px; padding:10px 16px; border:1px solid var(--admin-heading); border-radius:4px; background:var(--admin-heading); color:var(--admin-bg); font:inherit; cursor:pointer; } button:disabled { opacity:.55; cursor:default; } .secondary { background:transparent; color:var(--admin-heading); } .actions { display:flex; flex-wrap:wrap; gap:12px; } article { margin:24px 0; padding-bottom:20px; border-bottom:1px solid var(--admin-border); } :is(a,button,input,select):focus-visible { outline:2px solid var(--admin-heading); outline-offset:4px; } footer { margin:24px 0; } @media(max-width:480px) { .amount-row { grid-template-columns:1fr 100px; gap:10px; } dl { font-size:.9rem; } .selector button { width:100%; } }
</style>

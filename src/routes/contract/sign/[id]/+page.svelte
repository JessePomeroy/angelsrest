<script lang="ts">
import SignaturePad from "$lib/components/SignaturePad.svelte";

let { data } = $props();
let contract = $derived(data.contract);

let name = $state("");
let email = $state("");
let signatureData = $state("");
let submitting = $state(false);
let signed = $state(false);
let errorMsg = $state("");

const alreadySigned = $derived(contract.status === "signed");

function handleSignature(data: string) {
	signatureData = data;
}

async function submit() {
	if (!name.trim()) {
		errorMsg = "please enter your name";
		return;
	}
	if (!signatureData) {
		errorMsg = "please sign above before submitting";
		return;
	}

	errorMsg = "";
	submitting = true;

	try {
		const res = await fetch(`/api/contract/sign`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contractId: contract._id,
				signedByName: name.trim(),
				signedByEmail: email.trim() || undefined,
				signatureData,
			}),
		});

		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.message || "Failed to sign contract");
		}

		signed = true;
	} catch (err) {
		errorMsg = err instanceof Error ? err.message : "something went wrong";
	} finally {
		submitting = false;
	}
}

function formatCurrency(amount: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount);
}
</script>

<svelte:head>
	<title>{contract.title} — sign contract</title>
</svelte:head>

<div class="container">
	{#if signed}
		<div class="content">
			<h1>contract signed</h1>
			<p>thank you, {name}. your signature has been recorded.</p>
			<p class="muted">a copy will be sent to you for your records.</p>
		</div>
	{:else if alreadySigned}
		<div class="content">
			<h1>already signed</h1>
			<p>this contract was signed on {new Date(contract.signedAt ?? 0).toLocaleDateString()}.</p>
		</div>
	{:else}
		<div class="content">
			<h1>{contract.title}</h1>

			{#if contract.clientName}
				<p class="meta">prepared for {contract.clientName}</p>
			{/if}

			{#if contract.eventDate || contract.eventLocation}
				<div class="details">
					{#if contract.eventDate}
						<p><span class="label">date</span> {contract.eventDate}</p>
					{/if}
					{#if contract.eventLocation}
						<p><span class="label">location</span> {contract.eventLocation}</p>
					{/if}
				</div>
			{/if}

			{#if contract.totalPrice}
				<div class="details">
					<p><span class="label">total</span> {formatCurrency(contract.totalPrice)}</p>
					{#if contract.depositAmount}
						<p><span class="label">deposit</span> {formatCurrency(contract.depositAmount)}</p>
					{/if}
				</div>
			{/if}

			<div class="body">{@html contract.body}</div>

			<div class="sign-section">
				<h2>sign below</h2>

				<div class="field">
					<label for="name">your name *</label>
					<input id="name" type="text" bind:value={name} placeholder="full legal name" />
				</div>

				<div class="field">
					<label for="email">email (optional)</label>
					<input id="email" type="email" bind:value={email} placeholder="you@example.com" />
				</div>

				<div class="field">
					<!--
						Svelte can't statically see into the SignaturePad
						component to verify the canvas is nested under this
						label. The runtime relationship is wired explicitly
						via aria-labelledby on the wrapping div.
					-->
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label id="signature-label">signature *</label>
					<div aria-labelledby="signature-label">
						<SignaturePad onSign={handleSignature} />
					</div>
					{#if signatureData}
						<p class="captured">signature captured</p>
					{/if}
				</div>

				<div aria-live="polite">
					{#if errorMsg}
						<p class="error">{errorMsg}</p>
					{/if}
				</div>

				<button onclick={submit} disabled={submitting} type="button">
					{submitting ? 'signing...' : 'sign contract'}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		min-height: 100vh;
		display: flex;
		justify-content: center;
		padding: 3rem 1.5rem;
		background: #fafafa;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.content {
		max-width: 640px;
		width: 100%;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 500;
		color: #1a1a1a;
		margin-bottom: 0.5rem;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 500;
		color: #1a1a1a;
		margin-bottom: 1.25rem;
	}

	.meta {
		color: #888;
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}

	.details {
		margin-bottom: 1.5rem;
		padding: 1rem 0;
		border-top: 1px solid #e5e5e5;
	}

	.details p {
		margin: 0.25rem 0;
		font-size: 0.875rem;
		color: #333;
	}

	.label {
		color: #888;
		margin-right: 0.5rem;
	}

	.body {
		line-height: 1.7;
		color: #333;
		padding: 1.5rem 0;
		border-top: 1px solid #e5e5e5;
		border-bottom: 1px solid #e5e5e5;
		margin-bottom: 2rem;
		white-space: pre-wrap;
	}

	.sign-section {
		padding-top: 1rem;
	}

	.field {
		margin-bottom: 1.25rem;
	}

	label {
		display: block;
		font-size: 0.8125rem;
		color: #666;
		margin-bottom: 0.375rem;
	}

	input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 0.9375rem;
		background: #fff;
		color: #1a1a1a;
	}

	input:focus {
		outline: none;
		border-color: #888;
	}

	.captured {
		font-size: 0.8125rem;
		color: #22863a;
		margin-top: 0.375rem;
	}

	.error {
		color: #d32f2f;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: #1a1a1a;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-size: 0.9375rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	button:hover {
		background: #333;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.muted {
		color: #888;
		font-size: 0.875rem;
	}
</style>

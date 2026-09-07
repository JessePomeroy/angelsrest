<script lang="ts">
import { onMount } from "svelte";
import { loadBooking, type BookingApi } from "$lib/client/booking";

let { calLink, label }: { calLink: string; label: string } = $props();
let api = $state<BookingApi | null>(null);
let failed = $state(false);
let opened = false;

onMount(() => {
	let disposed = false;
	void loadBooking().then((booking) => {
		if (disposed) return;
		booking("ui", {
			hideEventTypeDetails: false,
			layout: "month_view",
			useSlotsViewOnSmallScreen: true,
		});
		api = booking;
	}).catch(() => {
		if (!disposed) failed = true;
	});
	return () => {
		disposed = true;
		if (opened) api?.("closeModal");
	};
});

function openBooking() {
	if (!api) return;
	opened = true;
	api("modal", { calLink });
}
</script>

<button type="button" class="booking-button" onclick={openBooking} disabled={!api} aria-busy={!api && !failed}>
  {label}
</button>
{#if failed}
  <p role="status">booking could not load. <a href="https://cal.com/{calLink.replace(/^\/+/, '')}">open booking page</a></p>
{/if}

<style>
  .booking-button { color: #000; min-height: 42px; padding: 10px 14px; border: 1px solid color-mix(in srgb, currentColor 28%, transparent); border-radius: 0; background: transparent; font-size: 0.78rem; font-weight: 500; letter-spacing: 0.08em; text-transform: lowercase; cursor: pointer; transition: border-color 160ms ease, background 160ms ease; }
  :global(.dark) .booking-button { color: #fafafa; }
  .booking-button:hover:not(:disabled) { border-color: var(--time-accent); background: color-mix(in srgb, currentColor 6%, transparent); }
  .booking-button:focus-visible { outline: 1px solid var(--time-accent); outline-offset: 2px; }
  .booking-button:disabled { cursor: wait; opacity: 0.5; }
  p { margin-top: 0.5rem; font-size: 0.8rem; }
  a { text-decoration: underline; }
</style>

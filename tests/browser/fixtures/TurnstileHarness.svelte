<script lang="ts">
import TurnstileWidget from "../../../src/lib/components/TurnstileWidget.svelte";

let visible = $state([true, true]);
let messages = $state(["idle", "idle"]);
let submissions = $state(["", ""]);
const widgets: Array<TurnstileWidget | undefined> = [];
function reset(index: number) {
	messages[index] = "reset";
	widgets[index]?.reset();
}
</script>

{#each ["first", "second"] as name, index}
	<section aria-label={name}>
		<button type="button" onclick={() => visible[index] = !visible[index]}>{visible[index] ? "Unmount" : "Mount"} {name}</button>
		<form onsubmit={(event) => { event.preventDefault(); submissions[index] = String(new FormData(event.currentTarget).get("cf-turnstile-response") ?? ""); }}>
			{#if visible[index]}
				<TurnstileWidget
					bind:this={widgets[index]}
					theme={index === 0 ? "auto" : "dark"}
					onverified={(token) => messages[index] = `verified:${token}`}
					onerror={(code) => messages[index] = `error:${code}`}
					onexpired={() => { reset(index); messages[index] = "expired"; }}
					onloaderror={() => messages[index] = "load-error"}
				/>
			{/if}
			<button type="button" onclick={() => reset(index)}>Reset {name}</button>
			<button type="submit">Submit {name}</button>
		</form>
		<output aria-label={`${name} status`}>{messages[index]}</output>
		<output aria-label={`${name} submitted token`}>{submissions[index]}</output>
	</section>
{/each}

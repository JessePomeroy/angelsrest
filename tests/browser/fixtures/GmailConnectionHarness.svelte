<script lang="ts">
import GoogleConnection from "../../../src/routes/admin/google-connection/+page.svelte";
</script>

<main class="connection-shell"><GoogleConnection /></main>

<style>
.connection-shell {
 --admin-text: #3d4044;
 --admin-heading: #202326;
 --admin-accent: #805a3b;
 min-height: 100dvh;
 background: #f9fafb;
 font-family: system-ui, sans-serif;
}
</style>

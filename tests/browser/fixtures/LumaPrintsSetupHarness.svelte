<script lang="ts">
import LumaPrintsSetupPage from "../../../src/lib/components/LumaPrintsSetupPage.svelte";
import type { LumaPrintsSetupData } from "../../../src/lib/lumaprintsSetup";
const params = new URLSearchParams(window.location.search);
const phase = params.get("phase") ?? "available";
const statuses: LumaPrintsSetupData["status"][] = ["disabled", "unauthorized", "unavailable", "unconfigured", "available", "connected", "historical"];
const status = statuses.find(value => value === phase) ?? "available";
const data: LumaPrintsSetupData = {
	siteUrl: "studio.example.invalid", clientName: "Quiet Light Studio", status,
	choices: status === "available" ? [
		{ connectionRef: "lp_fixture_client_original", storeId: 101, environment: "sandbox" },
		{ connectionRef: "lp_fixture_client_second", storeId: 102, environment: "sandbox" },
	] : [],
	connection: status === "connected" ? { connectionRef: "lp_fixture_client_original", storeId: 101, environment: "sandbox" } : null,
};
</script>

<LumaPrintsSetupPage {data} form={phase === "error" ? { message: "The store could not be verified. Check the client connection and try again." } : null} />

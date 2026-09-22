<script lang="ts">
import { AdminLayout, setAdminConfig } from "@jessepomeroy/admin";
import PlatformClientCreate from "../../../src/lib/components/PlatformClientCreate.svelte";
import { adminConfig } from "../../../src/lib/config/admin";
import { siteSettings } from "../handbook/public-data";

setAdminConfig({ ...adminConfig, api: { ...adminConfig.api, notifications: undefined } });
const data = { siteSettings, adminSession: { status: "authorized" as const, email: "operator@example.invalid", tier: "full" as const, isCreator: true }, newInquiryCount: 0 };
let selected = $state("");
</script>

<AdminLayout {data}>
	<PlatformClientCreate oncreated={client => { selected = client.siteUrl; }} />
	<p aria-label="Selected client">{selected}</p>
</AdminLayout>

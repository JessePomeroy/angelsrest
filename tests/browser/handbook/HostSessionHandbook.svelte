<script lang="ts">
import type { TenantAdminServerSession } from "@jessepomeroy/admin";
import Layout from "../../../src/routes/admin/+layout.svelte";
import BottomNav from "$lib/components/BottomNav.svelte";
import { adminSession } from "./data";

const phase = new URLSearchParams(window.location.search).get("session");
const session: TenantAdminServerSession = phase === "denied"
	? { status: "unauthorized", email: "designer@example.invalid" }
	: phase === "unverified" ? { status: "unauthenticated" } : adminSession;
</script>

<Layout data={{ adminSession: session, siteSettings: { artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [], seo: { description: null, ogImageUrl: null, keywords: [] } } }}>
	<p>This synthetic session reference does not load protected content.</p>
</Layout>
<BottomNav />

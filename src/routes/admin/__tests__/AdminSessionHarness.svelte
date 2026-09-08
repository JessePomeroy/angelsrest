<script lang="ts">
import type { TenantAdminServerSession } from "@jessepomeroy/admin";
import { untrack } from "svelte";
import Layout from "../+layout.svelte";

let { initialSession }: { initialSession: TenantAdminServerSession } = $props();
let adminSession = $state(untrack(() => initialSession));
export function setServerSession(session: TenantAdminServerSession) {
  adminSession = session;
}
</script>

<Layout data={{ adminSession, siteSettings: {
  artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [],
  seo: { description: null, ogImageUrl: null, keywords: [] },
} }}>
  <div data-protected-child>protected admin content</div>
</Layout>

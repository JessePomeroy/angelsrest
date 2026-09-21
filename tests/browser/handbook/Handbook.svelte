<script lang="ts">
import { readable } from "svelte/store";
import {
  AdminLayout, LoginPage, DashboardPage, OrdersPage, InquiriesPage, CrmPage, BoardPage,
  InvoicingPage, QuotesPage, ContractsPage, EmailsPage, MessagesPage,
  ClientGalleriesPage, SiteSettingsPage, EditorPagesPage, ContactPage, AboutPage,
  PortfolioGalleriesPage, PortfolioGalleryPage, ProductsPage, ProductPage, BlogPage, BlogPostPage, BlogSupportingPage,
  setAdminConfig, type AdminAuthClient,
} from "@jessepomeroy/admin";
import { adminConfig } from "$lib/config/admin";
import HostPlatformPage from "../../../src/routes/admin/platform/+page.svelte";
import BottomNav from "$lib/components/BottomNav.svelte";
import { siteSettings } from "./public-data";
import { page } from "./state.svelte";
import { adminSession, inquiries, settingsPayload, siteUrl } from "./data";

const params = new URLSearchParams(window.location.search);
const route = page.url.pathname;
const session = params.get("tier") === "basic" ? { ...adminSession, tier: "basic" as const, isCreator: false } : adminSession;
const data = { siteSettings, stripeConnectOnboardingEnabled: params.get("onboarding") === "true", stripeConnectOrigin: "https://hub.example.invalid", adminSession: session, newInquiryCount: 1, inquiries: params.get("state") === "empty" ? [] : inquiries, siteSettingsEditorSeed: settingsPayload };
const refused = async () => ({ error: { message: "Simulated sign-in failure. This reference never contacts an authentication provider." } });
const authClient: AdminAuthClient = {
  signIn: { email: refused, social: refused }, signUp: { email: refused },
  signOut: refused, changePassword: refused,
  useSession: () => readable({ data: { user: { email: "designer@example.invalid" } }, isPending: false }),
};
setAdminConfig({ ...adminConfig, siteUrl, fromEmail: "Demonstration <hello@example.invalid>", authClient,
  galleryWorkerUrl: "https://example.invalid", mutationTransport: "websocket",
  api: { ...adminConfig.api, notifications: undefined },
});
</script>

{#if params.get('screen') === 'login'}
  <LoginPage />
{:else}
  <AdminLayout {data}>
    {#if route === '/admin'}<DashboardPage {data} />
    {:else if route === '/admin/orders'}<OrdersPage {data} />
    {:else if route === '/admin/inquiries'}<InquiriesPage {data} />
    {:else if route === '/admin/crm'}<CrmPage {data} />
    {:else if route === '/admin/board'}<BoardPage {data} />
    {:else if route === '/admin/invoicing'}<InvoicingPage {data} />
    {:else if route === '/admin/quotes'}<QuotesPage {data} />
    {:else if route === '/admin/contracts'}<ContractsPage {data} />
    {:else if route === '/admin/emails'}<EmailsPage {data} />
    {:else if route === '/admin/messages'}<MessagesPage {data} />
    {:else if route === '/admin/platform'}<HostPlatformPage {data} />
    {:else if route === '/admin/galleries'}<ClientGalleriesPage adminSession={session} />
    {:else if route === '/admin/editor'}<SiteSettingsPage />
    {:else if route === '/admin/editor/pages'}<EditorPagesPage />
    {:else if route === '/admin/editor/pages/contact'}<ContactPage />
    {:else if route === '/admin/editor/pages/about'}<div class="host-about"><AboutPage /></div>
    {:else if route === '/admin/editor/portfolio'}<PortfolioGalleriesPage />
    {:else if route.startsWith('/admin/editor/portfolio/')}<PortfolioGalleryPage galleryId="demo-portfolio-1" />
    {:else if route === '/admin/editor/products'}<ProductsPage />
    {:else if route.startsWith('/admin/editor/products/')}<ProductPage productId="demo-product-1" />
    {:else if route === '/admin/editor/blog'}<BlogPage />
    {:else if route.includes('/admin/editor/blog/authors/')}<BlogSupportingPage documentId="demo-author-1" kind="author" />
    {:else if route.includes('/admin/editor/blog/categories/')}<BlogSupportingPage documentId="demo-category-1" kind="category" />
    {:else if route.startsWith('/admin/editor/blog/')}<BlogPostPage documentId="demo-post-1" />
    {:else}<p>Screen not configured in this isolated reference.</p>{/if}
  </AdminLayout>
{/if}
<BottomNav />

<style>
/* Match the host's documented operator-only About publication affordance. */
.host-about :global(.settings-header .actions button.primary) { display: none; }
</style>

<script lang="ts">
import { readable } from "svelte/store";
import {
	AdminLayout,
	LoginPage,
	DashboardPage,
	OrdersPage,
	InquiriesPage,
	CrmPage,
	BoardPage,
	InvoicingPage,
	QuotesPage,
	ContractsPage,
	EmailsPage,
	MessagesPage,
	PlatformPage,
	ClientGalleriesPage,
	SiteSettingsPage,
	EditorPagesPage,
	ContactPage,
	AboutPage,
	PortfolioGalleriesPage,
	PortfolioGalleryPage,
	ProductsPage,
	ProductPage,
	BlogPage,
	BlogPostPage,
	BlogSupportingPage,
	setAdminConfig,
	type AdminAuthClient,
} from "@jessepomeroy/admin";
import { adminConfig } from "$lib/config/admin";
import { page } from "./state.svelte";
import { adminSession, inquiries, settingsPayload, siteUrl } from "./data";

const route = page.url.pathname;
const params = new URLSearchParams(window.location.search);
const session = params.get("tier") === "basic"
	? { ...adminSession, tier: "basic" as const, isCreator: false }
	: adminSession;
const data = {
	adminSession: session,
	newInquiryCount: 0,
	inquiries,
	siteSettingsEditorSeed: settingsPayload,
};
const refused = async () => ({
	error: { message: "Authentication is disabled in this fictional preview." },
});
const authClient: AdminAuthClient = {
	signIn: { email: refused, social: refused },
	signUp: { email: refused },
	signOut: refused,
	changePassword: refused,
	useSession: () =>
		readable({ data: { user: { email: "designer@example.invalid" } }, isPending: false }),
};
setAdminConfig({
	...adminConfig,
	siteUrl,
	fromEmail: "Preview <hello@example.invalid>",
	authClient,
	galleryWorkerUrl: "https://example.invalid",
	mutationTransport: "websocket",
	api: { ...adminConfig.api, notifications: undefined },
	editor: {
		...adminConfig.editor,
		portfolio: {
			...adminConfig.editor?.portfolio,
			mediaBaseUrl: `${window.location.origin}/media`,
		},
		products: { ...adminConfig.editor?.products, mediaBaseUrl: `${window.location.origin}/media` },
		blog: { ...adminConfig.editor?.blog, mediaBaseUrl: `${window.location.origin}/media` },
		aboutPage: {
			...adminConfig.editor?.aboutPage,
			initialPayload: {},
			mediaBaseUrl: `${window.location.origin}/media`,
		},
	},
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
	{:else if route === '/admin/platform'}<PlatformPage {data} />
	{:else if route === '/admin/galleries'}<ClientGalleriesPage adminSession={session} />
	{:else if route === '/admin/editor'}<SiteSettingsPage />
	{:else if route === '/admin/editor/pages'}<EditorPagesPage />
	{:else if route === '/admin/editor/pages/contact'}<ContactPage />
	{:else if route === '/admin/editor/pages/about'}<div class="host-about"><AboutPage /></div>
	{:else if route === '/admin/editor/portfolio'}<PortfolioGalleriesPage />
	{:else if route.startsWith('/admin/editor/portfolio/')}<PortfolioGalleryPage galleryId={route.slice('/admin/editor/portfolio/'.length)} />
	{:else if route === '/admin/editor/products'}<ProductsPage />
	{:else if route.startsWith('/admin/editor/products/')}<ProductPage productId="demo-product-1" />
	{:else if route === '/admin/editor/blog'}<BlogPage />
	{:else if route.includes('/admin/editor/blog/authors/')}<BlogSupportingPage documentId="demo-author-1" kind="author" />
	{:else if route.includes('/admin/editor/blog/categories/')}<BlogSupportingPage documentId="demo-category-1" kind="category" />
	{:else if route.startsWith('/admin/editor/blog/')}<BlogPostPage documentId="demo-post-1" />
	{:else}<p>Choose an editor example.</p>{/if}
</AdminLayout>
{/if}

<style>
	/* Match the host's operator-only About publication affordance. */
	.host-about :global(.settings-header .actions button.primary) { display: none; }
</style>

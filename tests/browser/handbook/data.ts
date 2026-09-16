import {
	emptyPostDraft, newCatalogProductGraphDraft,
	type BlogSupportingDraft, type BlogSupportingEditorState,
	type CatalogProductEditorState, type InquiryUI, type PostEditorState,
} from "@jessepomeroy/admin";

// Fictional records only. No exported production records or capability URLs.
export const now = Date.parse("2026-09-10T14:00:00Z");
export const siteUrl = "handbook.example.invalid";
export const adminSession = {
	status: "authorized", email: "designer@example.invalid", tier: "full", isCreator: true,
} as const;
export const clients = [
	{ _id: "demo-client-1", _creationTime: now, siteUrl, name: "Avery Birch", email: "avery@example.invalid", category: "photography", type: "wedding", status: "lead", source: "website", boardColumnId: "lead", tags: [] },
	{ _id: "demo-client-2", _creationTime: now - 86400000, siteUrl, name: "Morgan Vale", email: "morgan@example.invalid", category: "photography", type: "wedding", status: "booked", source: "referral", boardColumnId: "booked", tags: [] },
	{ _id: "demo-client-3", _creationTime: now - 172800000, siteUrl, name: "Juniper Studio", email: "studio@example.invalid", category: "web", type: "website", status: "in-progress", source: "referral", tags: [] },
];
export const orders = ["new", "printing", "delivered"].map((status, index) => ({
	_id: `demo-order-${index + 1}`, _creationTime: now - index * 86400000, siteUrl,
	orderNumber: `DEMO-100${index + 1}`, stripeSessionId: "synthetic-no-provider-session",
	customerEmail: clients[index].email, customerName: clients[index].name,
	stripePaymentCurrency: "usd", total: [4500, 9000, 6500][index], status,
	stripeFeeCaptureStatus: "pending", fulfillmentType: "self",
	items: [{ productName: "Demonstration print", quantity: 1, price: [4500, 9000, 6500][index] }],
}));
export const invoices = ["draft", "sent", "paid"].map((status, index) => ({
	_id: `demo-invoice-${index + 1}`, _creationTime: now - index * 86400000, siteUrl,
	invoiceNumber: `INV-DEMO-00${index + 1}`, clientId: clients[index]._id,
	clientName: clients[index].name, clientEmail: clients[index].email,
	invoiceType: "one-time", status, items: [{ description: "Demonstration photography session", quantity: 1, unitPrice: 45000 }], taxPercent: 0, dueDate: "2026-09-24",
}));
export const quotes = ["draft", "sent", "accepted"].map((status, index) => ({
	_id: `demo-quote-${index + 1}`, _creationTime: now - index * 86400000, siteUrl,
	quoteNumber: `QUO-DEMO-00${index + 1}`, clientId: clients[index]._id,
	clientName: clients[index].name, clientEmail: clients[index].email, category: "photography", status,
	packages: [{ name: "Portrait session", description: "Demonstration package", price: 45000, included: ["One-hour session", "Edited digital gallery"] }], validUntil: "2026-09-30",
}));
export const contracts = ["draft", "signed"].map((status, index) => ({
	_id: `demo-contract-${index + 1}`, _creationTime: now - index * 86400000, siteUrl,
	title: "Demonstration portrait agreement", clientId: clients[index]._id,
	clientName: clients[index].name, clientEmail: clients[index].email, category: "photography", status,
	body: "Demonstration content only. This example is not a real agreement.", totalPrice: 45000,
}));
export const inquiries: InquiryUI[] = [
	{ _id: "demo-inquiry-1", name: "Avery Birch", email: "avery@example.invalid", subject: "Portrait session", message: "I would like to arrange a portrait session next month. This is fictional demonstration copy.", status: "new", submittedAt: "2026-09-10T14:00:00Z" },
	{ _id: "demo-inquiry-2", name: "Morgan Vale", email: "morgan@example.invalid", subject: "Print question", message: "Could you explain the framing options? This is fictional demonstration copy.", status: "replied", submittedAt: "2026-09-09T14:00:00Z" },
];
export const emailTemplates = [
	{ _id: "demo-email-1", name: "Portrait inquiry reply", category: "inquiry-reply", subject: "Your portrait session", body: "Hello {{clientName}}, thank you for your inquiry. This is a demonstration template.", variables: ["clientName"] },
	{ _id: "demo-email-2", name: "Gallery delivery", category: "gallery-delivery", subject: "Your photographs", body: "Hello {{clientName}}, your demonstration gallery is ready.", variables: ["clientName"] },
];
export const platformClients = [{ _id: "demo-platform-1", _creationTime: now, name: "Juniper Studio", email: "studio@example.invalid", siteUrl: "studio.example.invalid", tier: "full", subscriptionStatus: "active", adminEmails: ["studio@example.invalid"] }];
export const messages = [{ _id: "demo-message-1", _creationTime: now, siteUrl: "studio.example.invalid", sender: "client", content: "Could we review the updated gallery layout? This is a fictional conversation.", read: true }];
export const galleries = ["draft", "published"].map((status, index) => ({
	_id: `demo-delivery-${index + 1}`, _creationTime: now - index * 86400000, siteUrl,
	clientId: clients[index]._id, clientName: clients[index].name, name: `Demonstration gallery ${index + 1}`, slug: `demo-gallery-${index + 1}`,
	status, imageCount: 0, totalSizeBytes: 0, passwordProtected: false, downloadEnabled: true, favoritesEnabled: true,
}));
export const settingsPayload = { artistName: "Demonstration artist", siteTitle: "Angel's Rest", tagline: "Photography and prints", socialLinks: [], seoDescription: "Fictional content used to document the editor interface." };
export const contactPayload = { heading: "Get in touch", intro: "Tell me about your project.", email: "hello@example.invalid", availability: "Open for demonstration inquiries", responseTime: "Within two working days", confirmationMessage: "Thank you for your message.", bookingEnabled: false, inquiryChoices: ["Portraits", "Events", "Prints"] };
export function editorState(payload: Record<string, unknown>) {
	const revision = { revisionId: "demo-revision-1", schemaVersion: 1, payload, source: "admin", createdAt: now };
	return { documentId: "demo-document-1", draft: revision, published: revision, updatedAt: now, publishedAt: now };
}
export const portfolio = ["Window light", "Along the shore"].map((title, index) => {
	const revision = { revisionId: `demo-portfolio-revision-${index + 1}`, title, description: "Fictional portfolio entry", slug: `demo-portfolio-${index + 1}`, placementCount: 0, checksum: `demo-${index}`, createdAt: now, placements: [] };
	return { galleryId: `demo-portfolio-${index + 1}`, slug: revision.slug, portfolioOrder: index, isPublished: index === 1, isVisible: true, draft: revision, published: index === 1 ? revision : null, updatedAt: now, publishedAt: index === 1 ? now : null };
});

const productDraft = newCatalogProductGraphDraft("print", { title: "Window light — demonstration", slug: "demo-window-light" });
productDraft.description = "Fictional print record with no linked artwork or private original.";
productDraft.variants = [{ key: "demo-variant-1", order: 0, materialOptionKey: "archival-matte", sizeOptionKey: "4x6", retailPriceCents: 4500, status: "enabled" }];
export const product: CatalogProductEditorState = {
	productId: "demo-product-1", productKey: "demo-window-light", productKind: "print", graphVersion: 2,
	slug: productDraft.slug ?? null, updatedAt: now, publishedAt: null, published: null,
	draft: { revisionId: "demo-product-revision-1", schemaVersion: 2, productKind: "print", createdAt: now, title: productDraft.title, variantCount: 1, draft: productDraft, webMediaAssets: [], printSourceAssets: [] },
};
export const productSummaries = [{ ...product, createdAt: now, draft: { revisionId: "demo-product-revision-1", title: productDraft.title ?? null, saleAvailability: productDraft.saleAvailability, variantCount: 1, createdAt: now } }];

const postDraft = { ...emptyPostDraft(), title: "A study in available light", slug: "demo-available-light", format: "essay" as const, presentation: "standard" as const };
postDraft.body = { version: 1, blocks: [{ type: "paragraph", key: "demo-paragraph-1", children: [{ type: "text", key: "demo-text-1", text: "Fictional article copy for documenting the editing interface.", marks: [] }] }] };
export const post: PostEditorState = {
	documentId: "demo-post-1", documentKey: "demo-post", kind: "post", slug: postDraft.slug, rank: 0,
	draft: { revisionId: "demo-post-revision-1", schemaVersion: 1, draft: postDraft, source: "admin", createdAt: now },
	published: null, updatedAt: now, publishedAt: null, archivedAt: null,
};
export const postSummaries = [{ ...post, draft: { revisionId: "demo-post-revision-1", title: postDraft.title, format: postDraft.format, presentation: postDraft.presentation, displayPublishedAt: null } }];
function supportingDocument(draft: BlogSupportingDraft): BlogSupportingEditorState {
	return { documentId: `demo-${draft.kind}-1`, documentKey: `demo-${draft.kind}`, kind: draft.kind, slug: draft.slug ?? null, rank: 0,
		draft: { revisionId: `demo-${draft.kind}-revision-1`, schemaVersion: 1, draft, source: "admin", createdAt: now },
		published: null, updatedAt: now, publishedAt: null, archivedAt: null };
}
export const supportingDocuments = [
	supportingDocument({ kind: "author", name: "Demonstration artist", slug: "demo-artist" }),
	supportingDocument({ kind: "category", title: "Field notes", slug: "demo-field-notes", description: "Fictional category for a working reference." }),
];
export const supportingSummaries = supportingDocuments.map(document => ({ ...document,
	label: document.kind === "author" ? "Demonstration artist" : "Field notes", draftRevisionId: document.draft?.revisionId ?? null, publishedRevisionId: null,
}));

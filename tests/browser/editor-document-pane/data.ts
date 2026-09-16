import {
	emptyPostDraft,
	type BlogSupportingDraft,
	type BlogSupportingEditorState,
	type CatalogProductEditorState,
	type CatalogProductGraphV2Draft,
	type CatalogProductKind,
	type InquiryUI,
	type PortfolioMediaAsset,
	type PostEditorState,
} from "@jessepomeroy/admin";

const params = new URLSearchParams(window.location.search);
const populated = params.get("state") === "populated";
const productKinds: CatalogProductKind[] = [
	"print",
	"print_set",
	"postcard",
	"merchandise",
	"tapestry",
	"digital_download",
];
const productKind = productKinds.find((kind) => kind === params.get("kind")) ?? "print";

// Fictional records only. No exported production records or capability URLs.
export const now = Date.parse("2026-09-10T14:00:00Z");
export const siteUrl = "handbook.example.invalid";
export const adminSession = {
	status: "authorized",
	email: "designer@example.invalid",
	tier: "full",
	isCreator: true,
} as const;
export const clients = [
	{
		_id: "demo-client-1",
		_creationTime: now,
		siteUrl,
		name: "Avery Birch",
		email: "avery@example.invalid",
		category: "photography",
		type: "wedding",
		status: "lead",
		source: "website",
		boardColumnId: "lead",
		tags: [],
	},
	{
		_id: "demo-client-2",
		_creationTime: now - 86400000,
		siteUrl,
		name: "Morgan Vale",
		email: "morgan@example.invalid",
		category: "photography",
		type: "wedding",
		status: "booked",
		source: "referral",
		boardColumnId: "booked",
		tags: [],
	},
	{
		_id: "demo-client-3",
		_creationTime: now - 172800000,
		siteUrl,
		name: "Juniper Studio",
		email: "studio@example.invalid",
		category: "web",
		type: "website",
		status: "in-progress",
		source: "referral",
		tags: [],
	},
];
export const orders = ["new", "printing", "delivered"].map((status, index) => ({
	_id: `demo-order-${index + 1}`,
	_creationTime: now - index * 86400000,
	siteUrl,
	orderNumber: `DEMO-100${index + 1}`,
	stripeSessionId: "synthetic-no-provider-session",
	customerEmail: clients[index].email,
	customerName: clients[index].name,
	stripePaymentCurrency: "usd",
	total: [4500, 9000, 6500][index],
	status,
	stripeFeeCaptureStatus: "pending",
	fulfillmentType: "self",
	items: [{ productName: "Demonstration print", quantity: 1, price: [4500, 9000, 6500][index] }],
}));
export const invoices = ["draft", "sent", "paid"].map((status, index) => ({
	_id: `demo-invoice-${index + 1}`,
	_creationTime: now - index * 86400000,
	siteUrl,
	invoiceNumber: `INV-DEMO-00${index + 1}`,
	clientId: clients[index]._id,
	clientName: clients[index].name,
	clientEmail: clients[index].email,
	invoiceType: "one-time",
	status,
	items: [{ description: "Demonstration photography session", quantity: 1, unitPrice: 45000 }],
	taxPercent: 0,
	dueDate: "2026-09-24",
}));
export const quotes = ["draft", "sent", "accepted"].map((status, index) => ({
	_id: `demo-quote-${index + 1}`,
	_creationTime: now - index * 86400000,
	siteUrl,
	quoteNumber: `QUO-DEMO-00${index + 1}`,
	clientId: clients[index]._id,
	clientName: clients[index].name,
	clientEmail: clients[index].email,
	category: "photography",
	status,
	packages: [
		{
			name: "Portrait session",
			description: "Demonstration package",
			price: 45000,
			included: ["One-hour session", "Edited digital gallery"],
		},
	],
	validUntil: "2026-09-30",
}));
export const contracts = ["draft", "signed"].map((status, index) => ({
	_id: `demo-contract-${index + 1}`,
	_creationTime: now - index * 86400000,
	siteUrl,
	title: "Demonstration portrait agreement",
	clientId: clients[index]._id,
	clientName: clients[index].name,
	clientEmail: clients[index].email,
	category: "photography",
	status,
	body: "Demonstration content only. This example is not a real agreement.",
	totalPrice: 45000,
}));
export const inquiries: InquiryUI[] = [
	{
		_id: "demo-inquiry-1",
		name: "Avery Birch",
		email: "avery@example.invalid",
		subject: "Portrait session",
		message:
			"I would like to arrange a portrait session next month. This is fictional demonstration copy.",
		status: "new",
		submittedAt: "2026-09-10T14:00:00Z",
	},
	{
		_id: "demo-inquiry-2",
		name: "Morgan Vale",
		email: "morgan@example.invalid",
		subject: "Print question",
		message: "Could you explain the framing options? This is fictional demonstration copy.",
		status: "replied",
		submittedAt: "2026-09-09T14:00:00Z",
	},
];
export const emailTemplates = [
	{
		_id: "demo-email-1",
		name: "Portrait inquiry reply",
		category: "inquiry-reply",
		subject: "Your portrait session",
		body: "Hello {{clientName}}, thank you for your inquiry. This is a demonstration template.",
		variables: ["clientName"],
	},
	{
		_id: "demo-email-2",
		name: "Gallery delivery",
		category: "gallery-delivery",
		subject: "Your photographs",
		body: "Hello {{clientName}}, your demonstration gallery is ready.",
		variables: ["clientName"],
	},
];
export const platformClients = [
	{
		_id: "demo-platform-1",
		_creationTime: now,
		name: "Juniper Studio",
		email: "studio@example.invalid",
		siteUrl: "studio.example.invalid",
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: ["studio@example.invalid"],
	},
];
export const messages = [
	{
		_id: "demo-message-1",
		_creationTime: now,
		siteUrl: "studio.example.invalid",
		sender: "client",
		content: "Could we review the updated gallery layout? This is a fictional conversation.",
		read: true,
	},
];
export const galleries = ["draft", "published"].map((status, index) => ({
	_id: `demo-delivery-${index + 1}`,
	_creationTime: now - index * 86400000,
	siteUrl,
	clientId: clients[index]._id,
	clientName: clients[index].name,
	name: `Demonstration gallery ${index + 1}`,
	slug: `demo-gallery-${index + 1}`,
	status,
	imageCount: 0,
	totalSizeBytes: 0,
	passwordProtected: false,
	downloadEnabled: true,
	favoritesEnabled: true,
}));
export const settingsPayload = {
	artistName: "Demonstration artist",
	siteTitle: "Angel's Rest",
	tagline: "Photography and prints",
	socialLinks: populated
		? [
				{ platform: "Portfolio", url: "https://example.invalid/work" },
				{ platform: "Journal", url: "https://example.invalid/journal" },
			]
		: [],
	seoDescription: "Fictional content used to document the editor interface.",
};
export const contactPayload = {
	heading: "Get in touch",
	intro: "Tell me about your project.",
	email: "hello@example.invalid",
	availability: "Open for demonstration inquiries",
	responseTime: "Within two working days",
	confirmationMessage: "Thank you for your message.",
	bookingEnabled: false,
	inquiryChoices: ["Portraits", "Events", "Prints"],
};
export function editorState(payload: Record<string, unknown>) {
	const revision = {
		revisionId: "demo-revision-1",
		schemaVersion: 1,
		payload,
		source: "admin",
		createdAt: now,
	};
	return {
		documentId: "demo-document-1",
		draft: revision,
		published: revision,
		updatedAt: now,
		publishedAt: now,
	};
}
export const mediaAssets: PortfolioMediaAsset[] = [1, 2, 3].map((index) => ({
	_id: `demo-media-${index}`,
	assetId: `demo-media-${index}`,
	originalFilename:
		index === 1
			? "a-very-long-fictional-portrait-filename-for-testing-small-screens.svg"
			: `window-study-${index}.svg`,
	status: "ready",
	source: { contentType: "image/svg+xml", sizeBytes: 1400, width: 900, height: 1200 },
	derivatives: {
		thumb: { key: `study-${index}.svg`, width: 300, height: 400 },
		card: { key: `study-${index}.svg`, width: 900, height: 1200 },
	},
	createdAt: now,
}));
export const aboutPayload = {
	heading: "About",
	displayName: "Demonstration artist",
	role: "Photographer",
	introduction: "A fictional biography for reviewing the editor layout.",
	portraits: populated
		? [
				{
					key: "demo-portrait-1",
					assetId: mediaAssets[0]._id,
					order: 0,
					altText: "Fictional geometric window study",
				},
			]
		: [],
	sections: populated
		? [
				{
					key: "demo-section-1",
					title: "Selected work",
					items: [
						"Window studies, an invented exhibition",
						"Notes from the shoreline, a fictional publication",
					],
				},
			]
		: [],
	highlights: populated
		? [{ key: "demo-highlight-1", label: "Practice", value: "Photography and writing" }]
		: [],
};
export const portfolio = ["Window light", "Along the shore"].map((title, index) => {
	const placements = populated
		? mediaAssets.map((asset, order) => ({
				key: `demo-placement-${order}`,
				assetId: asset._id,
				order,
				altText: "A fictional window study",
				caption: "Synthetic layout reference",
			}))
		: [];
	const revision = {
		revisionId: `demo-portfolio-revision-${index + 1}`,
		title,
		description: "Fictional portfolio entry",
		slug: `demo-portfolio-${index + 1}`,
		placementCount: placements.length,
		checksum: `demo-${index}`,
		createdAt: now,
		placements,
	};
	return {
		galleryId: `demo-portfolio-${index + 1}`,
		slug: revision.slug,
		portfolioOrder: index,
		isPublished: index === 1,
		isVisible: true,
		draft: revision,
		published: index === 1 ? revision : null,
		updatedAt: now,
		publishedAt: index === 1 ? now : null,
	};
});

// Keep fixture initialization independent of the component barrel that imports this query stub.
const productDraft: CatalogProductGraphV2Draft = {
	schemaVersion: 2,
	productKind,
	title: "Window light — demonstration",
	slug: "demo-window-light",
	currency: "usd",
	saleAvailability: "unavailable",
	shopPlacement: { featured: false },
	fulfillmentMode: productKind === "digital_download" ? "digital_delivery" : "merchant_fulfilled",
	variants: [{ key: "default", order: 0, retailPriceCents: 4500, status: "disabled" }],
	webMedia: [],
};
productDraft.description = "Fictional print record with no linked artwork or private original.";
if (productKind === "print" || productKind === "print_set") {
	productDraft.fulfillmentMode = "production_partner";
	productDraft.printOptions = {
		borderOptionsEnabled: false,
		frameOptionsEnabled: false,
		framePriceMultiplierBasisPoints: 10_000,
	};
	productDraft.printSources = [];
	if (productKind === "print_set") productDraft.setMembers = [];
	productDraft.variants = ["4x6", "8x10", "11x14"].map((sizeOptionKey, order) => ({
		key: `demo-variant-${order + 1}`,
		order,
		materialOptionKey: "archival-matte",
		sizeOptionKey,
		retailPriceCents: 4500 + order * 1400,
		status: "enabled",
	}));
}
if (populated)
	productDraft.webMedia = [
		{
			key: "demo-product-image-1",
			role: productKind === "print_set" ? "cover" : "primary",
			order: 0,
			assetId: mediaAssets[0]._id,
			altText: "Fictional geometric study",
		},
	];
export const product: CatalogProductEditorState = {
	productId: "demo-product-1",
	productKey: "demo-window-light",
	productKind,
	graphVersion: 2,
	slug: productDraft.slug ?? null,
	updatedAt: now,
	publishedAt: null,
	published: null,
	draft: {
		revisionId: "demo-product-revision-1",
		schemaVersion: 2,
		productKind,
		createdAt: now,
		title: productDraft.title,
		variantCount: productDraft.variants?.length ?? 0,
		draft: productDraft,
		webMediaAssets: [],
		printSourceAssets: [],
	},
};
export const productSummaries = [
	{
		...product,
		createdAt: now,
		draft: {
			revisionId: "demo-product-revision-1",
			title: productDraft.title ?? null,
			saleAvailability: productDraft.saleAvailability,
			variantCount: productDraft.variants?.length ?? 0,
			createdAt: now,
		},
	},
];

const postDraft = {
	...emptyPostDraft(),
	title: "A study in available light",
	slug: "demo-available-light",
	format: "essay" as const,
	presentation: "standard" as const,
};
postDraft.authorSource = "siteSettings";
postDraft.summarySource = "body";
postDraft.body = {
	version: 1,
	blocks: [
		{
			type: "paragraph",
			key: "demo-paragraph-1",
			children: [
				{
					type: "text",
					key: "demo-text-1",
					text: "The afternoon light moves slowly across the studio wall. I leave the camera in one place and watch the shape of the window change. This fictional journal entry gives the editor a realistic paragraph to work with, so line length and spacing can be reviewed without borrowing any private writing. The photographs in this reference are simple geometric studies, created only for this local test.",
					marks: [],
				},
			],
		},
	],
};
if (populated)
	postDraft.mainImage = {
		key: "demo-main-image",
		assetId: mediaAssets[0]._id,
		altText: "Fictional geometric window study",
	};
export const post: PostEditorState = {
	documentId: "demo-post-1",
	documentKey: "demo-post",
	kind: "post",
	slug: postDraft.slug,
	rank: 0,
	draft: {
		revisionId: "demo-post-revision-1",
		schemaVersion: 1,
		draft: postDraft,
		source: "admin",
		createdAt: now,
	},
	published: null,
	updatedAt: now,
	publishedAt: null,
	archivedAt: null,
};
export const postSummaries = [
	{
		...post,
		draft: {
			revisionId: "demo-post-revision-1",
			title: postDraft.title,
			format: postDraft.format,
			presentation: postDraft.presentation,
			displayPublishedAt: null,
		},
	},
];
function supportingDocument(draft: BlogSupportingDraft): BlogSupportingEditorState {
	return {
		documentId: `demo-${draft.kind}-1`,
		documentKey: `demo-${draft.kind}`,
		kind: draft.kind,
		slug: draft.slug ?? null,
		rank: 0,
		draft: {
			revisionId: `demo-${draft.kind}-revision-1`,
			schemaVersion: 1,
			draft,
			source: "admin",
			createdAt: now,
		},
		published: null,
		updatedAt: now,
		publishedAt: null,
		archivedAt: null,
	};
}
export const supportingDocuments = [
	supportingDocument({ kind: "author", name: "Demonstration artist", slug: "demo-artist" }),
	supportingDocument({
		kind: "category",
		title: "Field notes",
		slug: "demo-field-notes",
		description: "Fictional category for a working reference.",
	}),
];
export const supportingSummaries = supportingDocuments.map((document) => ({
	...document,
	label: document.kind === "author" ? "Demonstration artist" : "Field notes",
	draftRevisionId: document.draft?.revisionId ?? null,
	publishedRevisionId: null,
}));

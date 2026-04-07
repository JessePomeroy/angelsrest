import type { Doc, Id } from "$convex/dataModel";

// Client types
export type Client = Doc<"photographyClients">;
export type ClientId = Id<"photographyClients">;
export type ClientCategory = "photography" | "web";
export type ClientStatus =
	| "lead"
	| "booked"
	| "in-progress"
	| "completed"
	| "archived";

// Invoice types
export type Invoice = Doc<"invoices">;
export type InvoiceId = Id<"invoices">;
export type InvoiceType =
	| "one-time"
	| "recurring"
	| "deposit"
	| "package"
	| "milestone";
export type InvoiceStatus =
	| "draft"
	| "sent"
	| "paid"
	| "partial"
	| "overdue"
	| "canceled";
export type InvoiceItem = {
	description: string;
	quantity: number;
	unitPrice: number;
};

// Quote types
export type Quote = Doc<"quotes">;
export type QuoteId = Id<"quotes">;
export type QuoteStatus =
	| "draft"
	| "sent"
	| "accepted"
	| "declined"
	| "expired";
export type QuotePackage = {
	name: string;
	description?: string;
	price: number;
	included?: string[];
};
export type QuotePreset = Doc<"quotePresets">;

// Contract types
export type Contract = Doc<"contracts">;
export type ContractId = Id<"contracts">;
export type ContractStatus = "draft" | "sent" | "signed" | "expired";
export type ContractTemplate = Doc<"contractTemplates">;

// Email template types
export type EmailTemplate = Doc<"emailTemplates">;
export type EmailCategory =
	| "inquiry-reply"
	| "booking-confirmation"
	| "reminder"
	| "gallery-delivery"
	| "follow-up"
	| "thank-you"
	| "custom";

// Order types
export type Order = Doc<"orders">;
export type OrderId = Id<"orders">;
export type OrderStatus =
	| "new"
	| "printing"
	| "ready"
	| "shipped"
	| "delivered"
	| "refunded";

// Platform types
export type PlatformClient = Doc<"platformClients">;
export type PlatformMessage = Doc<"platformMessages">;

// CRM enhancement types
export type ClientTag = Doc<"clientTags">;
export type TagAssignment = Doc<"clientTagAssignments">;
export type ActivityLogEntry = Doc<"activityLog">;

// Board types
export type BoardConfig = Doc<"boardConfigs">;

// Inquiry types
export type Inquiry = Doc<"inquiries">;
export type InquiryStatus = "new" | "read" | "replied";

// Portal types
export type PortalToken = Doc<"portalTokens">;

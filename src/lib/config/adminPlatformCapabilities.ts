import type { AdminAPI } from "@jessepomeroy/admin";
import { createStandardAdminAPI } from "@jessepomeroy/admin/client-integration";
import type * as generatedApiModule from "$convex/api";

type GeneratedApi = typeof generatedApiModule.api;

export type AdminBrowserCapabilities = Omit<
	AdminAPI,
	"documentEmailAttempts" | "crm" | "galleryDelivery"
> & {
	crm: AdminAPI["crm"] & Pick<GeneratedApi["crm"], "listClientsWithTags" | "scanClientsWithTags">;
	galleryDelivery: NonNullable<AdminAPI["galleryDelivery"]> &
		Pick<GeneratedApi["galleries"], "getUploadPolicy" | "listBySitePaginated">;
	readonly documentEmailAttempts?: never;
};

/**
 * Adapt the generated Convex module proxy to the stable capability interface
 * consumed by the shared Admin package's browser surface. Server-only
 * extensions live in the adjacent `.server` module and cannot be requested
 * through this interface.
 */
export function createAdminBrowserCapabilities(api: GeneratedApi): AdminBrowserCapabilities {
	const standard = createStandardAdminAPI(api);
	const capabilities = {
		...standard,
		crm: {
			...standard.crm,
			scanClientsWithTags: api.crm.scanClientsWithTags,
		},
		blogContent: {
			listForEditor: api.blogContent.listForEditor,
			getEditorState: api.blogContent.getEditorState,
			createDraft: api.blogContent.createDraft,
			saveDraft: api.blogContent.saveDraft,
			publish: api.blogContent.publish,
			discardDraft: api.blogContent.discardDraft,
			unpublish: api.blogContent.unpublish,
			archive: api.blogContent.archive,
			restore: api.blogContent.restore,
		},
		postContent: {
			listForEditor: api.postContent.listForEditor,
			getEditorState: api.postContent.getEditorState,
			createDraft: api.postContent.createDraft,
			saveDraft: api.postContent.saveDraft,
			publish: api.postContent.publish,
			discardDraft: api.postContent.discardDraft,
			unpublish: api.postContent.unpublish,
			archive: api.postContent.archive,
			restore: api.postContent.restore,
		},
		catalogProducts: {
			listForEditor: api.catalogProducts.listForEditor,
			getEditorState: api.catalogProducts.getEditorState,
			createDraft: api.catalogProducts.createDraft,
			saveDraft: api.catalogProducts.saveDraft,
			discardDraft: api.catalogProducts.discardDraft,
			remove: api.catalogProducts.remove,
		},
		gmailConversations: {
			connection: api.gmailConversations.connection,
			list: api.gmailConversations.list,
			create: api.gmailConversations.create,
			detail: api.gmailConversations.detail,
			messages: api.gmailConversations.messages,
			saveDraft: api.gmailConversations.saveDraft,
			queueSend: api.gmailConversations.queueSend,
			requestSync: api.gmailConversations.requestSync,
			reconcile: api.gmailConversations.reconcile,
			reserveAttachment: api.gmailConversations.reserveAttachment,
			retryAttachment: api.gmailConversations.retryAttachment,
			queue: api.gmailConversations.queue,
			setWorkflow: api.gmailConversations.setWorkflow,
			restartRecovery: api.gmailConversations.restartRecovery,
			requestDeletion: api.gmailConversations.requestDeletion,
			dataStatus: api.gmailConversations.dataStatus,
			deleteMailboxData: api.gmailConversations.deleteMailboxData,
		},
		platformOffboarding: {
			getState: api.platformOffboarding.getState,
			disable: api.platformOffboarding.disable,
			requestErasure: api.platformOffboarding.requestErasure,
			restoreAccess: api.platformOffboarding.restoreAccess,
			eraseRecords: api.platformOffboarding.eraseRecords,
		},
		contentCleanup: {
			list: api.contentCleanup.list,
			listRevisions: api.contentCleanup.listRevisions,
			purgeArchived: api.contentCleanup.purgeArchived,
			pruneRevision: api.contentCleanup.pruneRevision,
		},
	} satisfies AdminBrowserCapabilities;

	return capabilities;
}

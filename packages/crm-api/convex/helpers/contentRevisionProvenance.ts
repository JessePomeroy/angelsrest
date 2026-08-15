import type { Id } from "../_generated/dataModel";

type ContentRevisionProvenanceInput = {
	source: "admin" | "sanityImport" | "restore";
	restoredFromRevisionId?: Id<"contentRevisions">;
	restoreOperationId?: string;
	restoreRequestDigest?: string;
};

const RESTORE_OPERATION_ID_MAX = 120;
const RESTORE_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const RESTORE_REQUEST_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function requireRestoreOperationId(operationId: string) {
	if (
		!operationId
		|| operationId.length > RESTORE_OPERATION_ID_MAX
		|| operationId !== operationId.trim()
		|| !RESTORE_OPERATION_ID_PATTERN.test(operationId)
	) {
		throw new Error(
			`Restore operation IDs must be ${RESTORE_OPERATION_ID_MAX} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
	}
	return operationId;
}

/**
 * Enforce the additive restore-provenance invariant at every revision insert.
 * Existing rows remain schema-compatible; new restore rows must be complete,
 * and ordinary rows cannot carry restore-only fields.
 */
export function contentRevisionProvenanceFields(
	input: ContentRevisionProvenanceInput,
) {
	const hasAnyRestoreField =
		input.restoredFromRevisionId !== undefined
		|| input.restoreOperationId !== undefined
		|| input.restoreRequestDigest !== undefined;
	if (input.source !== "restore") {
		if (hasAnyRestoreField) {
			throw new Error("Non-restore content revisions cannot carry restore provenance");
		}
		return {};
	}
	if (
		!input.restoredFromRevisionId
		|| !input.restoreOperationId
		|| !input.restoreRequestDigest
		|| !RESTORE_REQUEST_DIGEST_PATTERN.test(input.restoreRequestDigest)
	) {
		throw new Error("Restore content revisions require complete valid provenance");
	}
	requireRestoreOperationId(input.restoreOperationId);
	return {
		restoredFromRevisionId: input.restoredFromRevisionId,
		restoreOperationId: input.restoreOperationId,
		restoreRequestDigest: input.restoreRequestDigest,
	};
}

import { ConvexError } from "convex/values";
import {
	connectionFailureData,
	type GmailConnectionCode,
	type GmailConnectionStage,
} from "../../../src/gmailConnection";

export function connectionError(code: GmailConnectionCode, stage: GmailConnectionStage) {
	return new ConvexError({ code, stage });
}

/** Cross the action boundary with known codes, never an SDK error or its cause. */
export function safeConnectionError(error: unknown, stage: GmailConnectionStage) {
	const known = error instanceof ConvexError ? connectionFailureData(error.data) : null;
	return new ConvexError(known ?? { code: "server_failure", stage });
}

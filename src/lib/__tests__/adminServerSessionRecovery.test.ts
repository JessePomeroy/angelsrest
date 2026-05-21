import { describe, expect, it } from "vitest";
import {
	shouldHoldAdminShellForServerSession,
	shouldRefreshAdminServerSession,
} from "$lib/adminServerSessionRecovery";

describe("admin server session recovery", () => {
	it("refreshes once when OAuth client auth exists before server auth catches up", () => {
		expect(
			shouldRefreshAdminServerSession({
				hasBrowser: true,
				hasAuthClient: true,
				sessionPending: false,
				sessionEmail: "thinkingofview@gmail.com",
				serverAuthorized: false,
				refreshAttempted: false,
				refreshInFlight: false,
			}),
		).toBe(true);
	});

	it("does not loop after a recovery refresh has already been attempted", () => {
		expect(
			shouldRefreshAdminServerSession({
				hasBrowser: true,
				hasAuthClient: true,
				sessionPending: false,
				sessionEmail: "thinkingofview@gmail.com",
				serverAuthorized: false,
				refreshAttempted: true,
				refreshInFlight: false,
			}),
		).toBe(false);
	});

	it("does not refresh before the client session has settled", () => {
		expect(
			shouldRefreshAdminServerSession({
				hasBrowser: true,
				hasAuthClient: true,
				sessionPending: true,
				sessionEmail: undefined,
				serverAuthorized: false,
				refreshAttempted: false,
				refreshInFlight: false,
			}),
		).toBe(false);
	});

	it("holds the admin shell while client auth is ahead of server auth", () => {
		expect(
			shouldHoldAdminShellForServerSession({
				hasAuthClient: true,
				sessionPending: false,
				sessionEmail: "thinkingofview@gmail.com",
				serverAuthorized: false,
			}),
		).toBe(true);
	});

	it("releases the admin shell once server auth is authoritative", () => {
		expect(
			shouldHoldAdminShellForServerSession({
				hasAuthClient: true,
				sessionPending: false,
				sessionEmail: "thinkingofview@gmail.com",
				serverAuthorized: true,
			}),
		).toBe(false);
	});
});

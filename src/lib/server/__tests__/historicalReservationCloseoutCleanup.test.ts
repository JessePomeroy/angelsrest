import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("accepted historical reservation closeout cleanup", () => {
	test("removes the callable incident mechanism and retains its audit schema", () => {
		for (const path of [
			"src/routes/api/admin/orders/reservation-closeout/+server.ts",
			"src/lib/server/historicalReservationCloseoutManifest.ts",
			"packages/crm-api/convex/historicalReservationCloseoutEvidence.ts",
		])
			expect(existsSync(resolve(root, path))).toBe(false);

		const orders = source("packages/crm-api/convex/orders.ts");
		const environmentExample = source(".env.example");
		expect(orders).not.toContain("closeHistoricalCheckoutSnapshotReservation");
		expect(orders).not.toContain("CHECKOUT_RESERVATION_CLOSEOUT_ID");
		expect(environmentExample).not.toContain("CHECKOUT_RESERVATION_CLOSEOUT_ID");

		const schema = source("packages/crm-api/convex/schema.ts");
		expect(schema).toContain("checkoutSnapshotReservationCloseouts: defineTable({");
		expect(schema).toContain('.index("by_closeoutId", ["closeoutId"])');
	});
});

import { describe, expect, test } from "vitest";
import schema from "./schema";

type ExportedValidator = {
	type: string;
	value?: ExportedValidator[];
};

type ExportedSchema = {
	tables: Array<{
		tableName: string;
		documentType: ExportedValidator;
	}>;
};

describe("Convex schema export", () => {
	test("keeps database index names within the backend's 64-character identifier limit", () => {
		// convex-test accepts longer names; the real backend rejects them at deployment.
		for (const [tableName, table] of Object.entries(schema.tables)) {
			for (const { indexDescriptor } of table[" indexes"]()) {
				expect(indexDescriptor.length, `${tableName}.${indexDescriptor}`).toBeLessThanOrEqual(64);
			}
		}
	});

	test("uses only backend-supported top-level document validators", () => {
		const schemaExporter = schema as unknown as { export: () => string };
		const exported = JSON.parse(schemaExporter.export()) as ExportedSchema;

		for (const table of exported.tables) {
			if (table.documentType.type === "union") {
				expect(
					table.documentType.value?.map((member) => member.type),
					table.tableName,
				).toEqual(
					expect.arrayContaining(["object"]),
				);
				expect(
					table.documentType.value?.every((member) => member.type === "object"),
					table.tableName,
				).toBe(true);
				continue;
			}

			expect(["object", "any"], table.tableName).toContain(
				table.documentType.type,
			);
		}
	});
});

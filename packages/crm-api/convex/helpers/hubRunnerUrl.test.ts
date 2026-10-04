import { expect, test } from "vitest";
import { hubRunnerUrl } from "../../src/hubRunnerUrl";

const production = "https://loyal-swan-967.convex.site";
const staging = "https://rosy-firefly-366.convex.site";
const path = "/api/internal/commerce-intake";

test.each(["/api/internal/commerce-intake", "/api/internal/print-fulfillment"] as const)(
	"each backend can dispatch %s only to its own host", (route) => {
		for (const origin of ["https://angelsrest.online", "https://www.angelsrest.online"]) {
			expect(hubRunnerUrl(origin + route, production, route).href).toBe(origin + route);
			expect(() => hubRunnerUrl(origin + route, staging, route)).toThrow();
		}
		const url = `https://staging.angelsrest.online${route}`;
		expect(hubRunnerUrl(url, staging, route).href).toBe(url);
		expect(() => hubRunnerUrl(url, production, route)).toThrow();
	},
);

test.each([undefined, "", "https://unknown.convex.site", `${staging}/`, "https://rosy-firefly-366.convex.cloud"])(
	"an unrecognized backend cannot dispatch: %s", (backend) => {
		expect(() => hubRunnerUrl(`https://staging.angelsrest.online${path}`, backend, path)).toThrow();
		expect(() => hubRunnerUrl(`https://angelsrest.online${path}`, backend, path)).toThrow();
	},
);

test.each([
	undefined, "", `http://staging.angelsrest.online${path}`, `https://staging.angelsrest.online:8443${path}`,
	`https://staging.angelsrest.online.example.com${path}`, `https://user@staging.angelsrest.online${path}`,
	`https://staging.angelsrest.online${path}?secret=other`, `https://staging.angelsrest.online${path}#other`,
	`https://staging.angelsrest.online${path}/`, "https://staging.angelsrest.online/api/internal/print-fulfillment",
	`https://127.0.0.1${path}`,
])("staging rejects malformed or unrelated destinations: %s", (url) => {
	expect(() => hubRunnerUrl(url, staging, path)).toThrow();
});

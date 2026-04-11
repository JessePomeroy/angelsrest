/**
 * Verify which Fine Art Paper sizes LumaPrints actually accepts.
 *
 * The angelsrest shop currently offers 6×9 and 12×18 prints, but neither
 * appears in the LumaPrints standard size list (4×6, 5×7, 8×8, 8×10, etc.).
 * This script hits the LumaPrints sandbox shipping-pricing endpoint with
 * each candidate size — if the API returns a price, the size is valid; if
 * it returns an error, the size is not supported and needs to be removed
 * from the catalog before the #23 expansion ships.
 *
 * Usage:
 *   npx tsx scripts/verify-lumaprints-sizes.ts
 *
 * Re-run this script whenever LumaPrints adds a new product category or
 * when verifying sizes for canvas (101) / metal (106) / framed FAP (105).
 * Pass `--subcategory <id>` to test a different subcategory.
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const API_KEY = process.env.LUMAPRINTS_API_KEY;
const API_SECRET = process.env.LUMAPRINTS_API_SECRET;
const STORE_ID = process.env.LUMAPRINTS_STORE_ID;

if (!API_KEY || !API_SECRET || !STORE_ID) {
	console.error(
		"Missing LUMAPRINTS_API_KEY / LUMAPRINTS_API_SECRET / LUMAPRINTS_STORE_ID",
	);
	process.exit(1);
}

// Default to production. The shipping pricing endpoint is a quote-only call
// (no order is created, no money moves), so it's safe to hit production with
// real credentials. Pass `--sandbox` to switch — but note that sandbox may
// require separate credentials that aren't in this .env.
const useSandbox = process.argv.includes("--sandbox");
const BASE_URL = useSandbox
	? "https://us.api-sandbox.lumaprints.com"
	: "https://us.api.lumaprints.com";

const subcategoryArg = process.argv.indexOf("--subcategory");
const SUBCATEGORY_ID =
	subcategoryArg >= 0 ? Number(process.argv[subcategoryArg + 1]) : 103001; // Archival Matte

// Sizes to verify. Existing angelsrest catalog (5) plus a known-good control
// and a sample of LumaPrints standard sizes we expect to add.
const SIZES: {
	width: number;
	height: number;
	label: string;
	expected: "standard" | "non-standard" | "control";
}[] = [
	{ width: 8, height: 10, label: "8×10", expected: "control" }, // known standard
	{ width: 4, height: 6, label: "4×6", expected: "standard" },
	{ width: 6, height: 9, label: "6×9", expected: "non-standard" }, // suspect
	{ width: 8, height: 12, label: "8×12", expected: "standard" },
	{ width: 12, height: 18, label: "12×18", expected: "non-standard" }, // suspect
	{ width: 16, height: 24, label: "16×24", expected: "standard" },
	{ width: 5, height: 7, label: "5×7", expected: "standard" }, // candidate to add
	{ width: 11, height: 14, label: "11×14", expected: "standard" }, // candidate to add
];

function authHeader(): string {
	return `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64")}`;
}

async function getShippingPrice(width: number, height: number) {
	const res = await fetch(`${BASE_URL}/api/v1/pricing/shipping`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: authHeader(),
		},
		body: JSON.stringify({
			storeId: Number(STORE_ID),
			shippingMethod: "default",
			recipient: {
				firstName: "Test",
				lastName: "User",
				addressLine1: "123 Main St",
				addressLine2: "",
				city: "Detroit",
				state: "MI",
				zipCode: "48201",
				country: "US",
				phone: "",
			},
			orderItems: [
				{
					subcategoryId: SUBCATEGORY_ID,
					quantity: 1,
					width,
					height,
					orderItemOptions: [39], // No Bleed (matches angelsrest webhook payload)
				},
			],
		}),
	});

	const text = await res.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { ok: res.ok, status: res.status, body };
}

async function main() {
	console.log(
		`\nVerifying Fine Art Paper sizes against subcategory ${SUBCATEGORY_ID} (${useSandbox ? "sandbox" : "production"})\n`,
	);
	console.log(
		`${"Size".padEnd(8)} ${"Expected".padEnd(14)} ${"API".padEnd(8)} Notes`,
	);
	console.log("─".repeat(70));

	const results: {
		label: string;
		expected: string;
		ok: boolean;
		note: string;
	}[] = [];

	for (const size of SIZES) {
		try {
			const { ok, status, body } = await getShippingPrice(
				size.width,
				size.height,
			);
			let note = "";
			if (ok && typeof body === "object" && body !== null) {
				const methods = (
					body as {
						shippingMethods?: {
							carrier?: string;
							method?: string;
							cost?: number;
						}[];
					}
				).shippingMethods;
				if (methods && methods.length > 0) {
					const cheapest = methods.reduce((a, b) =>
						(b.cost ?? Infinity) < (a.cost ?? Infinity) ? b : a,
					);
					note = `${methods.length} ship method(s), cheapest=$${cheapest.cost} (${cheapest.carrier} ${cheapest.method})`;
				} else {
					note = `200 OK ${JSON.stringify(body).slice(0, 60)}`;
				}
			} else {
				note = `status=${status} ${typeof body === "object" ? JSON.stringify(body).slice(0, 80) : String(body).slice(0, 80)}`;
			}
			results.push({ label: size.label, expected: size.expected, ok, note });
			console.log(
				`${size.label.padEnd(8)} ${size.expected.padEnd(14)} ${(ok ? "OK" : "FAIL").padEnd(8)} ${note}`,
			);
		} catch (err) {
			const note = err instanceof Error ? err.message : String(err);
			results.push({
				label: size.label,
				expected: size.expected,
				ok: false,
				note,
			});
			console.log(
				`${size.label.padEnd(8)} ${size.expected.padEnd(14)} ${"ERROR".padEnd(8)} ${note}`,
			);
		}
		// gentle pacing — don't hammer the sandbox
		await new Promise((r) => setTimeout(r, 250));
	}

	console.log("\n─── Summary ───");
	const failing = results.filter((r) => !r.ok);
	if (failing.length === 0) {
		console.log("All tested sizes accepted by LumaPrints.");
	} else {
		console.log(`${failing.length} size(s) rejected:`);
		for (const f of failing) {
			console.log(`  ${f.label}: ${f.note}`);
		}
	}
}

main().catch((err) => {
	console.error("Script failed:", err);
	process.exit(1);
});

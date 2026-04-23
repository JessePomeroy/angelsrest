/**
 * Full LumaPrints Fine Art Paper catalog availability sweep.
 *
 * Iterates over every (paper × size) combination we plan to offer in shop V2
 * and hits the LumaPrints production shipping-pricing endpoint to determine
 * which combos are actually accepted by their API. The output is a markdown
 * availability matrix that gets transcribed into
 * `angelsrest-studio/schemaTypes/constants/lumaprintsCatalog.ts`.
 *
 * Re-run this whenever LumaPrints updates their available SKUs, or when
 * adding a new paper / size to the catalog.
 *
 * Usage:
 *   npx tsx scripts/verify-lumaprints-catalog.ts
 *   npx tsx scripts/verify-lumaprints-catalog.ts --paper 103001       # one paper
 *   npx tsx scripts/verify-lumaprints-catalog.ts --sandbox            # hit sandbox, not prod
 *   npx tsx scripts/verify-lumaprints-catalog.ts --json > matrix.json # machine-readable
 *
 * Sister script: verify-lumaprints-sizes.ts (narrow size verification)
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const API_KEY = process.env.LUMAPRINTS_API_KEY;
const API_SECRET = process.env.LUMAPRINTS_API_SECRET;
const STORE_ID = process.env.LUMAPRINTS_STORE_ID;

if (!API_KEY || !API_SECRET || !STORE_ID) {
	console.error("Missing LUMAPRINTS_API_KEY / LUMAPRINTS_API_SECRET / LUMAPRINTS_STORE_ID");
	process.exit(1);
}

// Audit L19: support `--sandbox` so this script can be pointed at the
// LumaPrints sandbox without editing code. Matches the sandbox/prod
// switch the server uses via LUMAPRINTS_USE_SANDBOX in lumaprints.ts.
const USE_SANDBOX = process.argv.includes("--sandbox");
const BASE_URL = USE_SANDBOX
	? "https://us.api-sandbox.lumaprints.com"
	: "https://us.api.lumaprints.com";

// 7 Fine Art Paper subcategories — Metallic (103006) excluded per spec note Q1.
const PAPERS: { id: number; name: string; gsm: number | null }[] = [
	{ id: 103001, name: "Archival Matte", gsm: 230 },
	{ id: 103007, name: "Glossy", gsm: 260 },
	{ id: 103002, name: "Hot Press", gsm: 330 },
	{ id: 103003, name: "Cold Press", gsm: 340 },
	{ id: 103008, name: "Semi-Matte", gsm: null },
	{ id: 103005, name: "Semi-Glossy (Luster)", gsm: 250 },
	{ id: 103009, name: "Somerset Velvet", gsm: 255 },
];

// All 27 standard LumaPrints Fine Art Paper sizes from the reference doc.
const SIZES: { width: number; height: number; label: string }[] = [
	{ width: 4, height: 6, label: "4×6" },
	{ width: 5, height: 7, label: "5×7" },
	{ width: 8, height: 8, label: "8×8" },
	{ width: 8, height: 10, label: "8×10" },
	{ width: 8.5, height: 11, label: "8.5×11" },
	{ width: 8, height: 12, label: "8×12" },
	{ width: 10, height: 10, label: "10×10" },
	{ width: 11, height: 14, label: "11×14" },
	{ width: 11, height: 17, label: "11×17" },
	{ width: 12, height: 12, label: "12×12" },
	{ width: 12, height: 16, label: "12×16" },
	{ width: 12, height: 24, label: "12×24" },
	{ width: 12, height: 36, label: "12×36" },
	{ width: 16, height: 16, label: "16×16" },
	{ width: 16, height: 20, label: "16×20" },
	{ width: 16, height: 24, label: "16×24" },
	{ width: 16, height: 32, label: "16×32" },
	{ width: 20, height: 20, label: "20×20" },
	{ width: 20, height: 60, label: "20×60" },
	{ width: 24, height: 24, label: "24×24" },
	{ width: 24, height: 30, label: "24×30" },
	{ width: 24, height: 36, label: "24×36" },
	{ width: 30, height: 30, label: "30×30" },
	{ width: 30, height: 40, label: "30×40" },
	{ width: 30, height: 60, label: "30×60" },
	{ width: 40, height: 40, label: "40×40" },
	{ width: 40, height: 60, label: "40×60" },
];

const paperFilter = (() => {
	const idx = process.argv.indexOf("--paper");
	return idx >= 0 ? Number(process.argv[idx + 1]) : null;
})();
const jsonOutput = process.argv.includes("--json");

function authHeader(): string {
	return `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64")}`;
}

async function checkAvailability(
	subcategoryId: number,
	width: number,
	height: number,
): Promise<{ ok: boolean; status: number; error?: string }> {
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
					subcategoryId,
					quantity: 1,
					width,
					height,
					orderItemOptions: [39],
				},
			],
		}),
	});

	if (res.ok) return { ok: true, status: res.status };

	const text = await res.text();
	let errMsg = text;
	try {
		const body = JSON.parse(text);
		const m = (body as { message?: string | string[] }).message;
		errMsg = Array.isArray(m) ? m.join("; ") : (m ?? text);
	} catch {
		// keep raw text
	}
	return { ok: false, status: res.status, error: errMsg.slice(0, 100) };
}

async function main() {
	const papers = paperFilter ? PAPERS.filter((p) => p.id === paperFilter) : PAPERS;
	if (papers.length === 0) {
		console.error(`No paper matched id ${paperFilter}`);
		process.exit(1);
	}

	const matrix: Record<string, Record<string, { available: boolean; error?: string }>> = {};
	const totalCalls = papers.length * SIZES.length;
	let completed = 0;

	if (!jsonOutput) {
		console.error(
			`\nVerifying ${papers.length} paper(s) × ${SIZES.length} sizes = ${totalCalls} API calls (~${Math.ceil(totalCalls * 0.3)}s)\n`,
		);
	}

	for (const paper of papers) {
		matrix[paper.name] = {};
		for (const size of SIZES) {
			try {
				const res = await checkAvailability(paper.id, size.width, size.height);
				matrix[paper.name][size.label] = res.ok
					? { available: true }
					: { available: false, error: res.error };
			} catch (err) {
				matrix[paper.name][size.label] = {
					available: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
			completed++;
			if (!jsonOutput) {
				process.stderr.write(
					`\r  ${completed}/${totalCalls} (${paper.name} ${size.label})${" ".repeat(40)}`,
				);
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	}
	if (!jsonOutput) process.stderr.write("\n\n");

	if (jsonOutput) {
		console.log(JSON.stringify(matrix, null, 2));
		return;
	}

	// Markdown table — papers as columns, sizes as rows
	const headerCells = ["Size", ...papers.map((p) => p.name)];
	const widths = headerCells.map((h) => h.length);
	for (const size of SIZES) widths[0] = Math.max(widths[0], size.label.length);

	const fmt = (cell: string, i: number) => cell.padEnd(widths[i]);

	console.log(`| ${headerCells.map(fmt).join(" | ")} |`);
	console.log(`| ${widths.map((w) => "─".repeat(w)).join(" | ")} |`);
	for (const size of SIZES) {
		const row = [
			size.label,
			...papers.map((p) => (matrix[p.name][size.label].available ? "✓" : "✗")),
		];
		console.log(`| ${row.map(fmt).join(" | ")} |`);
	}

	// Summary
	console.log("\n─── Summary ───");
	for (const paper of papers) {
		const available = SIZES.filter((s) => matrix[paper.name][s.label].available).length;
		console.log(`  ${paper.name.padEnd(22)} ${available}/${SIZES.length} sizes available`);
	}

	// Failures with reasons
	const failures: { paper: string; size: string; error: string }[] = [];
	for (const paper of papers) {
		for (const size of SIZES) {
			const cell = matrix[paper.name][size.label];
			if (!cell.available && cell.error) {
				failures.push({
					paper: paper.name,
					size: size.label,
					error: cell.error,
				});
			}
		}
	}
	if (failures.length > 0) {
		console.log(`\n─── Rejections (${failures.length}) ───`);
		for (const f of failures.slice(0, 20)) {
			console.log(`  ${f.paper} ${f.size}: ${f.error}`);
		}
		if (failures.length > 20) console.log(`  … ${failures.length - 20} more`);
	}
}

main().catch((err) => {
	console.error("Script failed:", err);
	process.exit(1);
});

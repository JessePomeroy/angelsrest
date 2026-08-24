import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { atomicPublishPrivateExclusive } from "./portfolioAtomicState";
import {
	checkpointPortfolioMediaConfirmedMissing,
	checkpointPortfolioMediaPutAttempted,
	checkpointPortfolioMediaRegistered,
	checkpointPortfolioPublicDerivativesVerified,
	createPortfolioMediaCheckpoint,
	createPortfolioMediaReceipt,
	isPortfolioMediaLeaseConflictBody,
	isPortfolioMediaLeaseConflictEnvelope,
	type PortfolioMediaCheckpoint,
	parsePortfolioMediaCheckpoint,
	parsePortfolioMediaReceipt,
	portfolioMediaBoundaryTimeoutMs,
	validatePortfolioPublicDerivative,
	validatePortfolioTargetAnimation,
	validatePortfolioTransformedSource,
} from "./portfolioMediaTransfer";
import {
	PORTFOLIO_MEDIA_CANARY_REF,
	PORTFOLIO_MEDIA_MAX_BYTES,
	PORTFOLIO_MEDIA_TRANSFORM_QUERY,
	PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
	type PortfolioMediaPlanAsset,
	type PortfolioMediaTransferPlan,
} from "./portfolioMediaTransferPlan";

const WORKER_A = "11111111-1111-4111-8111-111111111111";
const WORKER_B = "22222222-2222-4222-8222-222222222222";
const MEDIA_A = "a".repeat(32);

function asset(canary = false): PortfolioMediaPlanAsset {
	const sourceAssetRef = canary
		? PORTFOLIO_MEDIA_CANARY_REF
		: "image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-1600x1000-jpg";
	return {
		sourceOrder: 0,
		gallerySourceId: "gallery-a",
		gallerySourceRevision: "revision-a",
		galleryPortfolioOrder: 0,
		placementOrder: 0,
		placementKey: "placement_a",
		sourceAltState: "absent",
		sourceAsset: {
			id: sourceAssetRef,
			revision: "asset-revision-a",
			url: "https://cdn.sanity.io/images/n7rvza4g/production/a.jpg",
			sha1: canary ? "3fd4cd2a50b69dd516c3dfac71248f2b9a2fbb54" : "a".repeat(40),
			originalContentType: canary ? "image/gif" : "image/jpeg",
			originalSizeBytes: 1_000,
			originalWidth: 1_600,
			originalHeight: 1_000,
		},
		transferSource: {
			recipe: PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
			query: PORTFOLIO_MEDIA_TRANSFORM_QUERY,
			url: `https://cdn.sanity.io/images/n7rvza4g/production/a.jpg?${PORTFOLIO_MEDIA_TRANSFORM_QUERY}`,
			expectedContentType: "image/webp",
			maximumSizeBytes: PORTFOLIO_MEDIA_MAX_BYTES,
		},
		canary,
	};
}

function plan(item: PortfolioMediaPlanAsset): PortfolioMediaTransferPlan {
	return {
		planDigest: "b".repeat(64),
		assets: [item],
	} as unknown as PortfolioMediaTransferPlan;
}

function registered(workerAssetId: string) {
	const prefix = `sites/angelsrest.online/web/${workerAssetId}/`;
	return {
		mediaAssetId: MEDIA_A,
		workerAssetId,
		targetCreatedAt: 1_000,
		derivatives: {
			thumb: {
				key: `${prefix}thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 200,
			},
			card: {
				key: `${prefix}card.webp`,
				contentType: "image/webp" as const,
				width: 960,
				height: 600,
			},
		},
	};
}

function publicDerivatives(item: PortfolioMediaPlanAsset, workerAssetId: string, seed = 7) {
	const delays = Array.from({ length: 17 }, () => 100);
	return {
		card: validatePortfolioPublicDerivative(
			item,
			workerAssetId,
			"card",
			"image/webp",
			new Uint8Array([seed, 1, 2]),
			item.canary
				? {
						format: "webp",
						width: 960,
						height: 10_200,
						pageHeight: 600,
						pages: 17,
						delay: delays,
						loop: 0,
					}
				: { format: "webp", width: 960, height: 600 },
		),
		display2048: validatePortfolioPublicDerivative(
			item,
			workerAssetId,
			"display2048",
			"image/webp",
			new Uint8Array([seed, 3, 4]),
			item.canary
				? {
						format: "webp",
						width: 810,
						height: 24_480,
						pageHeight: 1_440,
						pages: 17,
						delay: delays,
						loop: 0,
					}
				: { format: "webp", width: 1_600, height: 1_000 },
		),
	};
}

describe("Portfolio media transfer state", () => {
	test("recognizes only the exact raw or SvelteKit media lease conflict", () => {
		expect(
			isPortfolioMediaLeaseConflictEnvelope({
				message: "CMS media asset operation is already in progress",
			}),
		).toBe(true);
		expect(
			isPortfolioMediaLeaseConflictBody("CMS media asset operation is already in progress"),
		).toBe(true);
		expect(
			isPortfolioMediaLeaseConflictBody(
				'{"message":"CMS media asset operation is already in progress"}',
			),
		).toBe(true);
		for (const value of [
			{ message: "CMS media asset operation is already in progress", retryable: true },
			{ message: "Another conflict" },
			null,
		]) {
			expect(isPortfolioMediaLeaseConflictEnvelope(value)).toBe(false);
		}
		for (const value of [
			'{"message":"CMS media asset operation is already in progress","retryable":true}',
			'{"message":"Another conflict"}',
			"<html>Conflict</html>",
		]) {
			expect(isPortfolioMediaLeaseConflictBody(value)).toBe(false);
		}
	});

	test("extends only the media process request beyond the route lease", () => {
		expect(portfolioMediaBoundaryTimeoutMs("standard")).toBe(120_000);
		expect(portfolioMediaBoundaryTimeoutMs("process")).toBe(330_000);
	});

	test("durably bounds one capability reissue and produces an exact receipt", () => {
		const item = asset();
		const migrationPlan = plan(item);
		const transfer = validatePortfolioTransformedSource(item, new Uint8Array([1, 2, 3]), {
			format: "webp",
			width: 1_600,
			height: 1_000,
		});
		const initial = createPortfolioMediaCheckpoint(migrationPlan, item, transfer);
		const firstPut = checkpointPortfolioMediaPutAttempted(migrationPlan, item, initial, WORKER_A);
		const reset = checkpointPortfolioMediaConfirmedMissing(migrationPlan, item, firstPut);
		const secondPut = checkpointPortfolioMediaPutAttempted(migrationPlan, item, reset, WORKER_B);
		expect(() => checkpointPortfolioMediaConfirmedMissing(migrationPlan, item, secondPut)).toThrow(
			/bounded capability reissue/,
		);
		const complete = checkpointPortfolioMediaRegistered(
			migrationPlan,
			item,
			secondPut,
			registered(WORKER_B),
		);
		expect(() => createPortfolioMediaReceipt(migrationPlan, item, complete)).toThrow(/not ready/);
		const accepted = checkpointPortfolioPublicDerivativesVerified(
			migrationPlan,
			item,
			complete,
			publicDerivatives(item, WORKER_B),
		);
		expect(parsePortfolioMediaCheckpoint(accepted, migrationPlan)).toEqual(accepted);
		const receipt = createPortfolioMediaReceipt(migrationPlan, item, accepted);
		expect(parsePortfolioMediaReceipt(receipt, migrationPlan)).toEqual(receipt);
		expect(receipt.sourceAltState).toBe("absent");
		expect(receipt).not.toHaveProperty("altText");
		expect(receipt.target.publicDerivatives.card).toMatchObject({
			key: `sites/angelsrest.online/web/${WORKER_B}/card.webp`,
			contentType: "image/webp",
			sizeBytes: 3,
			width: 960,
			height: 600,
			sha256: createHash("sha256")
				.update(new Uint8Array([7, 1, 2]))
				.digest("hex"),
		});
		expect(receipt.target.publicDerivatives.display2048).toMatchObject({
			key: `sites/angelsrest.online/web/${WORKER_B}/display-2048.webp`,
			contentType: "image/webp",
			sizeBytes: 3,
			width: 1_600,
			height: 1_000,
			sha256: createHash("sha256")
				.update(new Uint8Array([7, 3, 4]))
				.digest("hex"),
		});
		const alternate = createPortfolioMediaReceipt(
			migrationPlan,
			item,
			checkpointPortfolioPublicDerivativesVerified(
				migrationPlan,
				item,
				complete,
				publicDerivatives(item, WORKER_B, 8),
			),
		);
		expect(alternate.receiptDigest).not.toBe(receipt.receiptDigest);

		const damagedCheckpoint = structuredClone(accepted) as PortfolioMediaCheckpoint;
		damagedCheckpoint.transfer.width = 1_601;
		expect(() => parsePortfolioMediaCheckpoint(damagedCheckpoint, migrationPlan)).toThrow(
			/transfer boundary/,
		);
		const damagedReceipt = structuredClone(receipt);
		damagedReceipt.target.publicDerivatives.card.sha256 = "f".repeat(64);
		expect(() => parsePortfolioMediaReceipt(damagedReceipt, migrationPlan)).toThrow(/digest/);
	});

	test("requires the exact animated WebP canary before a receipt", () => {
		const item = asset(true);
		const migrationPlan = plan(item);
		const delays = Array.from({ length: 17 }, () => 100);
		const transfer = validatePortfolioTransformedSource(item, new Uint8Array([4, 5, 6]), {
			format: "webp",
			width: 810,
			height: 24_480,
			pageHeight: 1_440,
			pages: 17,
			delay: delays,
			loop: 0,
		});
		expect(transfer.height).toBe(1_440);
		const put = checkpointPortfolioMediaPutAttempted(
			migrationPlan,
			item,
			createPortfolioMediaCheckpoint(migrationPlan, item, transfer),
			WORKER_A,
		);
		const complete = checkpointPortfolioMediaRegistered(
			migrationPlan,
			item,
			put,
			registered(WORKER_A),
		);
		expect(() => createPortfolioMediaReceipt(migrationPlan, item, complete)).toThrow(/not ready/);
		const inspection = validatePortfolioTargetAnimation(
			{ format: "webp", pages: 17, delay: delays, loop: 0 },
			"card",
		);
		const accepted = checkpointPortfolioPublicDerivativesVerified(
			migrationPlan,
			item,
			complete,
			publicDerivatives(item, WORKER_A),
		);
		const receipt = createPortfolioMediaReceipt(migrationPlan, item, accepted);
		expect(receipt.target.publicDerivatives.card.animation).toEqual(inspection);
		expect(receipt.target.publicDerivatives.display2048.animation).toEqual(inspection);
		const damaged = structuredClone(accepted) as PortfolioMediaCheckpoint;
		if (!damaged.targetPublicDerivatives?.card.animation) throw new Error("test setup failed");
		damaged.targetPublicDerivatives.card.animation.frameCount = 16 as 17;
		expect(() => parsePortfolioMediaCheckpoint(damaged, migrationPlan)).toThrow(/binding/);
	});

	test("rejects oversized transformed input and a flattened canary", () => {
		const staticAsset = asset();
		expect(() =>
			validatePortfolioTransformedSource(
				staticAsset,
				new Uint8Array(PORTFOLIO_MEDIA_MAX_BYTES + 1),
				{ format: "webp", width: 1_600, height: 1_000 },
			),
		).toThrow(/WebP input boundary/);
		expect(() =>
			validatePortfolioTransformedSource(asset(true), new Uint8Array([1]), {
				format: "webp",
				width: 810,
				height: 1_440,
				pages: 1,
				delay: [100],
				loop: 0,
			}),
		).toThrow(/17 frames/);
	});

	test("atomically publishes one complete owner-only immutable artifact", async () => {
		const directory = await mkdtemp(join(tmpdir(), "portfolio-atomic-state-"));
		const target = join(directory, "receipt.json");
		try {
			await writeFile(join(directory, ".receipt.json.tmp-crashed"), "partial", { mode: 0o600 });
			await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
			await atomicPublishPrivateExclusive(target, '{"complete":true}\n');
			expect(await readFile(target, "utf8")).toBe('{"complete":true}\n');
			expect((await stat(target)).mode & 0o777).toBe(0o600);
			await expect(
				atomicPublishPrivateExclusive(target, '{"complete":false}\n'),
			).rejects.toMatchObject({ code: "EEXIST" });
			expect(await readFile(target, "utf8")).toBe('{"complete":true}\n');
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});
});

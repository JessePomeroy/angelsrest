import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
	ABOUT_CONTACT_PORTRAIT_SOURCE,
	createAboutContactPortraitReceipt,
} from "./aboutContactPortraitTransfer";
import {
	assertExactAboutContactPlanSourceBytes,
	writeAboutContactPlanBundle,
} from "./sanity-about-contact-plan";
import {
	ABOUT_CONTACT_CAPABILITY_FILES,
	ABOUT_CONTACT_COMMANDS_FILE,
	ABOUT_CONTACT_PLAN_BINDINGS,
	ABOUT_CONTACT_PLAN_FILE,
	aboutContactCapabilityFiles,
	createAboutContactPlanArtifact,
	digestAboutContactPlanSource,
	parseAboutContactPlanArtifact,
	parseAboutContactPlanSource,
} from "./sanityAboutContactPlanOperator";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function sourceFixture() {
	return {
		about: [
			{
				_id: "1450e80b-0632-4b6e-9872-a0b37613d44e",
				_rev: "0oFX1HjggfKYZSiwvjNCAx",
				_type: "about",
				name: "Jesse Pomeroy",
				portrait: {
					_type: "image",
					asset: {
						_ref: "image-aba850a0e7530ff7b6e22dc152d26bffa04ead14-1440x2160-jpg",
						_type: "reference",
					},
				},
				seo: { description: null, ogImageUrl: null },
				shortBio: "multidisciplinary artist",
				social: { instagram: "https://www.instagram.com/stray_black_dog" },
			},
		],
		contact: [
			{
				_id: "8cb60fab-7420-457d-b316-c6a3f99e9d2b",
				_rev: "wP6EQO6WASyr6NrTg1vG1z",
				_type: "contactPage",
				bookingEnabled: true,
				bookingUrl: "https://cal.com/jesse-s1wmio/photosession",
				email: "hello@angelsrest.online",
				heading: "Get in Touch",
				intro: [
					{
						_key: "47c57bc495d7",
						_type: "block",
						children: [
							{
								_key: "46935dc1d94f",
								_type: "span",
								marks: [],
								text: "I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project,\ndrop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's\ntalk. I'll get back to you as soon as I can.",
							},
						],
						markDefs: [],
						style: "normal",
					},
				],
			},
		],
	};
}

function portraitReceipt() {
	return createAboutContactPortraitReceipt({
		mediaAssetId: "j1234567890abcdefghijk",
		workerAssetId: "123e4567-e89b-42d3-a456-426614174000",
	});
}

describe("R6 About/Contact compact plan operator", () => {
	test("seals the authorized parity choices and exact replay calls deterministically", async () => {
		const source = parseAboutContactPlanSource(sourceFixture());
		const first = await createAboutContactPlanArtifact(source, portraitReceipt());
		const second = await createAboutContactPlanArtifact(source, portraitReceipt());

		expect(second).toEqual(first);
		await expect(digestAboutContactPlanSource(source)).resolves.toBe(
			ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256,
		);
		const exactBytes = new TextEncoder().encode(JSON.stringify(sourceFixture()));
		expect(() => assertExactAboutContactPlanSourceBytes(exactBytes)).not.toThrow();
		expect(() =>
			assertExactAboutContactPlanSourceBytes(
				new TextEncoder().encode(`${JSON.stringify(sourceFixture())}\n`),
			),
		).toThrow(/byte-identical/);
		expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
		expect(first.plan.entries).toMatchObject([
			{
				kind: "aboutPage",
				payload: {
					heading: "about",
					displayName: "Jesse Pomeroy",
					portraits: [{ altText: "Jesse Pomeroy" }],
				},
			},
			{
				kind: "contactPage",
				payload: {
					intro:
						"I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project,\ndrop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's\ntalk. I'll get back to you as soon as I can.",
					bookingEnabled: true,
					bookingUrl: "https://cal.com/jesse-s1wmio/photosession",
					inquiryChoices: [],
				},
			},
		]);
		expect(first.plan.decisionSet).toMatchObject({
			aboutHeading: { action: "use-host-fallback-owner-approved" },
			aboutBiography: { action: "confirmed-absent-owner-approved" },
			aboutPortrait: {
				action: "use-local-portrait-owner-approved",
				localSha256: ABOUT_CONTACT_PORTRAIT_SOURCE.sha256,
			},
			aboutSeoImage: {
				action: "keep-host-fallback-owner-approved",
				fallbackPath: "/og-image.jpg",
			},
			aboutSocial: { action: "defer-to-site-settings-owner-approved" },
			contactBookingTypes: { action: "omit-owner-approved" },
		});
		expect(Object.values(first.calls).every((call) => call.replayCount === 2)).toBe(true);
		await expect(parseAboutContactPlanArtifact(first)).resolves.toEqual(first);

		const tampered = structuredClone(first);
		tampered.calls.import.binding = "0".repeat(64);
		await expect(parseAboutContactPlanArtifact(tampered)).rejects.toThrow(/sealed plan/);

		const nonmatchingSource = sourceFixture();
		(nonmatchingSource.about[0] as Record<string, unknown>).heading = "invented";
		await expect(
			createAboutContactPlanArtifact(
				parseAboutContactPlanSource(nonmatchingSource),
				portraitReceipt(),
			),
		).rejects.toThrow(/absent source heading/);
	});

	test("writes one owner-only bundle without exposing capability values in commands", async () => {
		const parent = await mkdtemp(resolve(tmpdir(), "about-contact-plan-test-"));
		temporaryDirectories.push(parent);
		await chmod(parent, 0o700);
		const output = resolve(parent, "sealed");
		const artifact = await createAboutContactPlanArtifact(
			parseAboutContactPlanSource(sourceFixture()),
			portraitReceipt(),
		);
		await writeAboutContactPlanBundle(output, artifact);

		expect((await stat(output)).mode & 0o777).toBe(0o700);
		for (const file of [
			ABOUT_CONTACT_PLAN_FILE,
			ABOUT_CONTACT_COMMANDS_FILE,
			...Object.values(ABOUT_CONTACT_CAPABILITY_FILES),
		]) {
			expect((await stat(resolve(output, file))).mode & 0o777).toBe(0o600);
		}
		const stored = JSON.parse(
			await readFile(resolve(output, ABOUT_CONTACT_PLAN_FILE), "utf8"),
		) as unknown;
		await expect(parseAboutContactPlanArtifact(stored)).resolves.toEqual(artifact);

		const capabilityValues = Object.values(aboutContactCapabilityFiles(artifact)).map((value) =>
			value.trim().split("=").slice(1).join("="),
		);
		expect(new Set(capabilityValues).size).toBe(3);
		const commands = await readFile(resolve(output, ABOUT_CONTACT_COMMANDS_FILE), "utf8");
		for (const capability of capabilityValues) expect(commands).not.toContain(capability);
		expect(commands.match(/aboutContactMigration:attestMediaSource/g)).toHaveLength(2);
		expect(commands.match(/aboutContactMigration:importDrafts/g)).toHaveLength(2);
		expect(commands.match(/aboutContactMigration:publishDrafts/g)).toHaveLength(2);
		await expect(
			execFileAsync("bash", ["-n", resolve(output, ABOUT_CONTACT_COMMANDS_FILE)]),
		).resolves.toMatchObject({ stderr: "" });
	});
});

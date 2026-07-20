import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readSanitySourceConfig } from "./sanitySourceConfig";

const ORIGINAL_PROJECT_ID = process.env.PUBLIC_SANITY_PROJECT_ID;
const ORIGINAL_DATASET = process.env.PUBLIC_SANITY_DATASET;
const temporaryDirectories: string[] = [];

afterEach(async () => {
	if (ORIGINAL_PROJECT_ID === undefined) delete process.env.PUBLIC_SANITY_PROJECT_ID;
	else process.env.PUBLIC_SANITY_PROJECT_ID = ORIGINAL_PROJECT_ID;
	if (ORIGINAL_DATASET === undefined) delete process.env.PUBLIC_SANITY_DATASET;
	else process.env.PUBLIC_SANITY_DATASET = ORIGINAL_DATASET;
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe.sequential("shared Sanity source configuration", () => {
	test("preserves the existing .env.local parsing and production dataset default", async () => {
		delete process.env.PUBLIC_SANITY_PROJECT_ID;
		delete process.env.PUBLIC_SANITY_DATASET;
		const directory = await mkdtemp(join(tmpdir(), "angelsrest-sanity-config-"));
		temporaryDirectories.push(directory);
		await writeFile(
			join(directory, ".env.local"),
			'PUBLIC_SANITY_PROJECT_ID="project-from-file" # retained behavior\n',
		);

		await expect(readSanitySourceConfig(directory)).resolves.toEqual({
			projectId: "project-from-file",
			dataset: "production",
		});
	});

	test("keeps process environment values authoritative", async () => {
		process.env.PUBLIC_SANITY_PROJECT_ID = "project-from-process";
		process.env.PUBLIC_SANITY_DATASET = "staging";
		const directory = await mkdtemp(join(tmpdir(), "angelsrest-sanity-config-"));
		temporaryDirectories.push(directory);
		await writeFile(
			join(directory, ".env.local"),
			"PUBLIC_SANITY_PROJECT_ID=project-from-file\nPUBLIC_SANITY_DATASET=production\n",
		);

		await expect(readSanitySourceConfig(directory)).resolves.toEqual({
			projectId: "project-from-process",
			dataset: "staging",
		});
	});
});

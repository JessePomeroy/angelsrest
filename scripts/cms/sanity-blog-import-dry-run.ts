import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createClient } from "@sanity/client";
import {
	createSanityBlogImportDryRunReport,
	createSanityBlogImportManifest,
	type SanityBlogImportSource,
} from "../../packages/crm-api/convex/helpers/sanityBlogImport";
import {
	createSanityBlogImportPrepArtifacts,
	createSanityBlogImportRemediation,
	parseSanityBlogImageAssetMap,
	SANITY_BLOG_IMAGE_ASSET_MAP_FILENAME,
	SANITY_BLOG_REVIEW_CHECKLIST_FILENAME,
} from "./sanityBlogImportPrep";

const DEFAULT_OUTPUT_PATH = "/tmp/angelsrest-sanity-blog-import-report.json";

type CliOptions = {
	outputPath: string;
	imageAssetMappingPath?: string;
	prepDirectory?: string;
};

function stripInlineComment(value: string) {
	const hashIndex = value.search(/\s#/);
	return (hashIndex === -1 ? value : value.slice(0, hashIndex)).trim();
}

async function readEnvFile(path: string) {
	try {
		const contents = await readFile(path, "utf8");
		return Object.fromEntries(
			contents
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#") && line.includes("="))
				.map((line) => {
					const equalsIndex = line.indexOf("=");
					const key = line.slice(0, equalsIndex).trim();
					const rawValue = stripInlineComment(line.slice(equalsIndex + 1).trim());
					const value = rawValue.replace(/^['"]|['"]$/g, "");
					return [key, value];
				}),
		);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
			return {};
		throw error;
	}
}

function cliOptions(args: string[]): CliOptions {
	const options: CliOptions = { outputPath: DEFAULT_OUTPUT_PATH };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--output") {
			options.outputPath = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--image-asset-map") {
			options.imageAssetMappingPath = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--prep-directory") {
			options.prepDirectory = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!options.outputPath) throw new Error("--output requires a path");
	if (options.imageAssetMappingPath === "") {
		throw new Error("--image-asset-map requires a path");
	}
	if (options.prepDirectory === "") throw new Error("--prep-directory requires a path");
	return options;
}

async function readImageAssetIds(path: string | undefined) {
	if (!path) return {};
	const contents = await readFile(resolve(path), "utf8");
	return parseSanityBlogImageAssetMap(JSON.parse(contents) as unknown);
}

function sourceQuery() {
	return `{
		"authors": *[_type == "author"] | order(_id asc) {
			_id,
			_type,
			name,
			slug,
			image {
				_key,
				asset,
				alt,
				caption
			},
			bio
		},
		"categories": *[_type == "category"] | order(_id asc) {
			_id,
			_type,
			title,
			description
		},
		"posts": *[_type == "post"] | order(_id asc) {
			_id,
			_type,
			title,
			postType,
			slug,
			author,
			mainImage {
				_key,
				asset,
				alt,
				caption
			},
			categories,
			publishedAt,
			brief,
			approach,
			result,
			gearUsed,
			body
		}
	}`;
}

function sanitizedDocumentSummary(manifest: ReturnType<typeof createSanityBlogImportManifest>) {
	return {
		authors: manifest.authors.map((author) => ({
			sourceId: author.sourceId,
			documentKey: author.documentKey,
			slug: author.draft.slug ?? null,
			hasPortrait: Boolean(author.draft.portrait),
			issueCount: author.issues.length,
		})),
		categories: manifest.categories.map((category) => ({
			sourceId: category.sourceId,
			documentKey: category.documentKey,
			slug: category.draft.slug ?? null,
			issueCount: category.issues.length,
		})),
		posts: manifest.posts.map((post) => ({
			sourceId: post.sourceId,
			documentKey: post.documentKey,
			slug: post.draft.slug ?? null,
			format: post.draft.format ?? null,
			presentation: post.draft.presentation ?? null,
			bodyBlockCount: post.draft.body.blocks.length,
			bodySourceAssetRefs: post.bodySourceAssetRefs,
			hasAuthorReference: Boolean(post.draft.authorDocumentKey),
			categoryReferenceCount: post.draft.categories.length,
			hasMainImage: Boolean(post.draft.mainImage),
			issueCount: post.issues.length,
		})),
	};
}

type PrepOutputPaths = {
	directory: string;
	imageAssetMap: string;
	reviewChecklist: string;
};

function prepOutputPaths(directory: string): PrepOutputPaths {
	const resolvedDirectory = resolve(directory);
	return {
		directory: resolvedDirectory,
		imageAssetMap: join(resolvedDirectory, SANITY_BLOG_IMAGE_ASSET_MAP_FILENAME),
		reviewChecklist: join(resolvedDirectory, SANITY_BLOG_REVIEW_CHECKLIST_FILENAME),
	};
}

async function assertPathDoesNotExist(path: string) {
	try {
		await access(path);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	}
	throw new Error(`Refusing to overwrite existing import-preparation file: ${path}`);
}

async function validatePrepOutputPaths(
	paths: PrepOutputPaths,
	outputPath: string,
	imageAssetMappingPath: string | undefined,
) {
	const reservedInputs = new Set([
		outputPath,
		...(imageAssetMappingPath ? [resolve(imageAssetMappingPath)] : []),
	]);
	for (const path of [paths.imageAssetMap, paths.reviewChecklist]) {
		if (reservedInputs.has(path)) {
			throw new Error(`Import-preparation output collides with an input or report path: ${path}`);
		}
	}
	await Promise.all([
		assertPathDoesNotExist(paths.imageAssetMap),
		assertPathDoesNotExist(paths.reviewChecklist),
	]);
}

async function main() {
	const options = cliOptions(process.argv.slice(2));
	const outputPath = resolve(options.outputPath);
	const prepPaths = options.prepDirectory ? prepOutputPaths(options.prepDirectory) : undefined;
	if (prepPaths) {
		await validatePrepOutputPaths(prepPaths, outputPath, options.imageAssetMappingPath);
	}
	const envFile = await readEnvFile(resolve(".env.local"));
	const projectId = process.env.PUBLIC_SANITY_PROJECT_ID ?? envFile.PUBLIC_SANITY_PROJECT_ID;
	const dataset =
		process.env.PUBLIC_SANITY_DATASET ?? envFile.PUBLIC_SANITY_DATASET ?? "production";
	if (!projectId) {
		throw new Error("PUBLIC_SANITY_PROJECT_ID is required");
	}
	const imageAssetIds = await readImageAssetIds(options.imageAssetMappingPath);
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	const source = await client.fetch<SanityBlogImportSource>(sourceQuery());
	const manifest = createSanityBlogImportManifest(source, { imageAssetIds });
	const report = createSanityBlogImportDryRunReport(manifest);
	const remediation = createSanityBlogImportRemediation(source, manifest, imageAssetIds);
	const output = {
		generatedAt: new Date().toISOString(),
		source: {
			projectId,
			dataset,
			perspective: "published",
		},
		report,
		documents: sanitizedDocumentSummary(manifest),
		remediation,
	};
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
	console.log(
		`Wrote Sanity Blog import dry-run report to ${outputPath}: ${report.status} (${report.counts.errors} errors, ${report.counts.warnings} warnings)`,
	);
	if (prepPaths) {
		const prep = createSanityBlogImportPrepArtifacts({ projectId, dataset, remediation });
		await mkdir(prepPaths.directory, { recursive: true });
		await Promise.all([
			writeFile(prepPaths.imageAssetMap, `${JSON.stringify(prep.imageAssetMap, null, 2)}\n`, {
				flag: "wx",
			}),
			writeFile(prepPaths.reviewChecklist, prep.checklistMarkdown, { flag: "wx" }),
		]);
		console.log(
			`Wrote import-preparation files to ${prepPaths.directory}: ${prep.counts.assets} source images, ${prep.counts.missingMappingValues} without supplied mappings, ${prep.counts.altText} alt-text review items`,
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

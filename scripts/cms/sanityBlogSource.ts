import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SanityClient } from "@sanity/client";
import type { SanityBlogImportSource } from "../../packages/crm-api/convex/helpers/sanityBlogImport";

/** One shared, deterministic projection for dry-run and execution planning. */
export function sanityBlogSourceQuery() {
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

export async function fetchPublishedSanityBlogSource(client: SanityClient) {
	return await client.fetch<SanityBlogImportSource>(
		sanityBlogSourceQuery(),
		{},
		{ perspective: "published" },
	);
}

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
					return [key, rawValue.replace(/^['"]|['"]$/g, "")];
				}),
		);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
			return {};
		throw error;
	}
}

export async function readSanityBlogSourceConfig(repositoryRoot: string) {
	const envFile = await readEnvFile(resolve(repositoryRoot, ".env.local"));
	const projectId = process.env.PUBLIC_SANITY_PROJECT_ID ?? envFile.PUBLIC_SANITY_PROJECT_ID;
	const dataset =
		process.env.PUBLIC_SANITY_DATASET ?? envFile.PUBLIC_SANITY_DATASET ?? "production";
	if (!projectId) throw new Error("PUBLIC_SANITY_PROJECT_ID is required");
	return { projectId, dataset };
}

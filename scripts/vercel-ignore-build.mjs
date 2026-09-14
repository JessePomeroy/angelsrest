import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function shouldSkipBuild(env = process.env, cwd = process.cwd()) {
	const previous = env.VERCEL_GIT_PREVIOUS_SHA;
	if (env.VERCEL_FORCE_BUILD === "1" || !/^[a-f0-9]{40}$/i.test(previous ?? "")) return false;
	try {
		const files = execFileSync(
			"git",
			["diff", "--name-only", "--no-renames", previous, "HEAD", "--"],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		)
			.trim()
			.split("\n")
			.filter(Boolean);
		// Empty diffs may be intentional redeploys after environment/config changes.
		return (
			files.length > 0 &&
			files.every(
				(file) =>
					file.startsWith("docs/") ||
					file.startsWith("tests/") ||
					file === "README.md" ||
					file === "AGENTS.md" ||
					/^\.changeset\/[^/]+\.md$/.test(file),
			)
		);
	} catch {
		// Shallow clones, first deploys and unknown history must build.
		return false;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const skip = shouldSkipBuild();
	console.log(
		skip
			? "Skipping deployment: only documentation or tests changed."
			: "Building deployment: runtime changes or no safe comparison.",
	);
	// Vercel's ignore command uses zero to cancel, one to continue.
	process.exitCode = skip ? 0 : 1;
}

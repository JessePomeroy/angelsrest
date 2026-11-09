#!/usr/bin/env python3
"""Bounded TLC check plus offline source probes; never writes application files."""

import argparse
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

PILOT = Path(__file__).resolve().parent
ROOT = PILOT.parents[2]
REL = PILOT.relative_to(ROOT)
TOOLS = Path(tempfile.gettempdir()) / "angelsrest-order-intake-tools-v1"
JAR_SHA = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
JRE_SHA = "aeab55d064a1a27a3744b0880b9b414077b4ed2b1790817eea3df60aec946431"
JAR_URL = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
JRE_URL = ("https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10/"
           "OpenJDK21U-jre_x64_linux_hotspot_21.0.9_10.tar.gz")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_env():
    # No dotenv, inherited provider credentials, NODE_OPTIONS, or live endpoints.
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8",
            "CI": "true", "NO_COLOR": "1"}


def command(args, cwd=ROOT, timeout=180):
    return subprocess.run([str(a) for a in args], cwd=cwd, env=clean_env(),
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout, check=False)


def fetch_pinned(url, path, expected, setup):
    if not path.exists():
        if not setup:
            raise RuntimeError(f"Missing {path.name}; run the same command with --setup first")
        print(f"Downloading development tool: {path.name}", flush=True)
        partial = path.with_suffix(path.suffix + ".partial")
        with urllib.request.urlopen(url, timeout=90) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        if digest(partial) != expected:
            partial.unlink()
            raise RuntimeError(f"Checksum mismatch: {path.name}")
        partial.rename(path)
    if digest(path) != expected:
        raise RuntimeError(f"Checksum mismatch: {path.name}")


def toolchain(setup):
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("Pinned setup supports Linux x86_64 only; no formal result on this host")
    TOOLS.mkdir(exist_ok=True)
    jar = TOOLS / "tla2tools.jar"
    archive = TOOLS / "temurin-jre-21.0.9+10.tar.gz"
    fetch_pinned(JAR_URL, jar, JAR_SHA, setup)
    fetch_pinned(JRE_URL, archive, JRE_SHA, setup)
    java = TOOLS / "jdk-21.0.9+10-jre/bin/java"
    if not java.exists():
        with tarfile.open(archive) as bundle:
            bundle.extractall(TOOLS, filter="data")
    version = command([java, "-version"])
    if version.returncode or '21.0.9' not in version.stdout:
        raise RuntimeError("Pinned Java runtime did not start")
    return java, jar, version.stdout


def source_snapshot():
    baseline = json.loads((PILOT / "source-snapshot.json").read_text())
    actual = {path: digest(ROOT / path) for path in baseline["sources"]}
    stale = [path for path in actual if actual[path] != baseline["sources"][path]]
    if stale:
        raise RuntimeError("Model source correspondence is STALE; review before updating hashes: "
                           + ", ".join(stale))
    tree = {str(p.relative_to(ROOT)): digest(p) for folder in
            ["packages/crm-api/convex", "packages/crm-api/src", "packages/crm-api/test"]
            for p in sorted((ROOT / folder).rglob("*"))
            if p.is_file() and p.suffix in {".ts", ".js", ".json"}}
    tree_hash = hashlib.sha256(json.dumps(tree, sort_keys=True).encode()).hexdigest()
    if tree_hash != baseline["execution_tree_sha256"]:
        raise RuntimeError("Copied CRM execution tree is STALE; inspect dependencies/fixtures before refreshing")
    return actual


def check_tlc(java, jar, work, output, name, model, config, should_fail):
    model_dir = work / name
    model_dir.mkdir()
    (model_dir / "OrderIntake.tla").write_text(model)
    (model_dir / "OrderIntake.cfg").write_text(config)
    args = [java, "-XX:+UseParallelGC", "-Xmx512m", "-cp", jar, "tlc2.TLC",
            "-workers", "1", "-seed", "1", "-fp", "0",
            "-metadir", model_dir / "states", "-config", "OrderIntake.cfg", "OrderIntake.tla"]
    result = command(args, cwd=model_dir)
    (output / f"{name}.log").write_text(result.stdout)
    violation = "Invariant SingleDurableReceipt is violated" in result.stdout
    completed = "Model checking completed. No error has been found." in result.stdout
    counts = re.search(r"([\d,]+) states generated, ([\d,]+) distinct states found, ([\d,]+) states left on queue", result.stdout)
    count_data = dict(zip(("generated", "distinct", "queued"),
                         [int(x.replace(",", "")) for x in counts.groups()])) if counts else None
    if should_fail:
        ok = result.returncode == 12 and violation
    else:
        ok = result.returncode == 0 and completed and count_data is not None and count_data["queued"] == 0
    print(f"{name}: {'expected violation' if should_fail and ok else 'PASS' if ok else 'FAILED'} {count_data}", flush=True)
    return {"name": name, "ok": ok, "expected_failure": should_fail,
            "exit_code": result.returncode, "states": count_data}


def copy_sources(work):
    target = work / "implementation"
    target.mkdir()
    # Copy code/fixtures only; no .env, Git data, credentials, or operational data.
    for dirname in ["packages/crm-api/convex", "packages/crm-api/test", "packages/crm-api/src"]:
        shutil.copytree(ROOT / dirname, target / dirname,
                        ignore=shutil.ignore_patterns("node_modules", ".env*", "*.map"))
    (target / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    fixture_dir = target / REL
    fixture_dir.mkdir(parents=True)
    shutil.copy2(PILOT / "intake.bridge.test.ts", fixture_dir / "intake.bridge.test.ts")
    host_dir = target / "src/lib/server"
    host_dir.mkdir(parents=True)
    for name in ["checkoutSnapshotConsumer.ts", "webhookOrderPayload.ts", "stripeConnect.ts"]:
        shutil.copy2(ROOT / "src/lib/server" / name, host_dir / name)
    (target / "vitest.config.mjs").write_text('''import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  envDir: false,
  resolve: { alias: { "$lib": fileURLToPath(new URL("./src/lib", import.meta.url)) } },
  test: {
    environment: "edge-runtime",
    include: ["docs/verification/order-intake-state-pilot/intake.bridge.test.ts",
      "packages/crm-api/convex/checkoutSnapshotReservations.test.ts",
      "packages/crm-api/convex/orders.test.ts",
      "packages/crm-api/convex/commerceIntakeInbox.test.ts"],
    testTimeout: 10000,
  },
});
''')
    return target


def implementation_check(target, output, name, mutant=False, bridge_only=False):
    args = ["unshare", "-Urn", "--", "node", ROOT / "node_modules/vitest/vitest.mjs",
            "run", "--config", target / "vitest.config.mjs", "--reporter=json",
            "--outputFile", output / f"{name}.json"]
    if bridge_only:
        args.append("docs/verification/order-intake-state-pilot/intake.bridge.test.ts")
    if mutant:
        args += ["-t", "fresh order route retries converge after a lost reply"]
    result = command(args, cwd=target)
    (output / f"{name}.log").write_text(result.stdout)
    report_file = output / f"{name}.json"
    data = json.loads(report_file.read_text()) if report_file.exists() else {}
    failed = data.get("numFailedTests", 0)
    total = data.get("numTotalTests", 0)
    messages = [message for suite in data.get("testResults", [])
                for test in suite.get("assertionResults", []) for message in test.get("failureMessages", [])]
    # Require the intended duplicate-row assertion; compilation/setup errors do not count.
    meaningful = sum("length of 1" in message and "got 2" in message for message in messages)
    ok = (result.returncode == 1 and failed == 3 and meaningful == 3) if mutant else (
        result.returncode == 0 and failed == 0 and total > 0 and data.get("success") is True)
    print(f"{name}: {'mutation caught' if mutant and ok else 'PASS' if ok else 'FAILED'} "
          f"({data.get('numPassedTests', 0)} passed, {failed} failed)", flush=True)
    return {"name": name, "ok": ok, "expected_failure": mutant,
            "exit_code": result.returncode, "tests": total,
            "passed": data.get("numPassedTests"), "failed": failed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup", action="store_true", help="download checksum-pinned dev tools if missing")
    parser.add_argument("--out", type=Path, help="new evidence directory; must not already exist")
    args = parser.parse_args()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = (args.out or ROOT / "test-results" / f"order-intake-state-{stamp}-{os.getpid()}").resolve()
    output.mkdir(parents=True, exist_ok=False)
    summary = {"started_utc": stamp, "status": "incomplete", "results": [],
               "evidence_directory": str(output), "python": platform.python_version()}
    try:
        summary["sources"] = source_snapshot()
        summary["head"] = command(["git", "rev-parse", "HEAD"]).stdout.strip()
        summary["git_status"] = command(["git", "status", "--short"]).stdout
        summary["node"] = command(["node", "--version"]).stdout.strip()
        summary["pnpm"] = command(["pnpm", "--version"]).stdout.strip()
        if summary["node"] != "v24.18.0":
            raise RuntimeError("Implementation probes are pinned to observed Node v24.18.0; review a version change")
        if not (ROOT / "node_modules/vitest/vitest.mjs").exists():
            raise RuntimeError("Install repository dev dependencies using its lockfile first")
        namespace = command(["unshare", "-Urn", "--", "true"])
        if namespace.returncode:
            raise RuntimeError("Offline user/network namespace unavailable: " + namespace.stdout)
        java, jar, summary["java"] = toolchain(args.setup)
        summary["tool_sha256"] = {"tla2tools.jar": JAR_SHA, "temurin-jre-21.0.9+10.tar.gz": JRE_SHA}
        model = (PILOT / "OrderIntake.tla").read_text()
        config = (PILOT / "OrderIntake.cfg").read_text()
        summary["pilot_sha256"] = {p.name: digest(p) for p in PILOT.iterdir()
                                   if p.is_file() and p.suffix in {".tla", ".cfg", ".ts", ".py"}}
        with tempfile.TemporaryDirectory(prefix="angelsrest-order-intake-") as temp:
            work = Path(temp)
            results = summary["results"]
            results.append(check_tlc(java, jar, work, output, "tlc-connected", model, config, False))
            platform_config = config.replace("StripeConnectedAccountId = connectedAccountA", "StripeConnectedAccountId = noConnectedAccount")
            platform_config = platform_config.replace("AccountScope = connectedScopeA", "AccountScope = platformScope")
            results.append(check_tlc(java, jar, work, output, "tlc-platform", model, platform_config, False))
            # Controls exist only in this disposable directory, never in canonical model/code.
            needle = '  /\\ IF orders # {}'
            assert model.count(needle) == 1
            broken = model.replace(needle, '  /\\ IF FALSE')
            results.append(check_tlc(java, jar, work, output, "tlc-missing-lookup", broken, config, True))
            split_action = '''SplitConsume(w) ==
  /\\ pc[w] = "details" /\\ reservation
  /\\ reservation' = FALSE
  /\\ UNCHANGED <<orders, pc, route, attempt, pendingReply, replies>>

'''
            split = model.replace("Next ==", split_action + "Next ==")
            split = split.replace("ResolveRouting(w) \\/ FetchDetails(w)", "SplitConsume(w) \\/ ResolveRouting(w) \\/ FetchDetails(w)")
            results.append(check_tlc(java, jar, work, output, "tlc-split-transaction", split, config, True))
            for name, variant in [("missing-lookup", broken), ("split-transaction", split)]:
                (output / f"{name}.patch").write_text("".join(difflib.unified_diff(
                    model.splitlines(True), variant.splitlines(True), fromfile="OrderIntake.tla", tofile=name + "/OrderIntake.tla")))
            target = copy_sources(work)
            versions = command(["node", "--input-type=module", "-e",
                "import {createRequire} from 'node:module'; const r=createRequire(import.meta.url); "
                "for(const p of ['vitest','convex','convex-test','@edge-runtime/vm']) "
                "console.log(p, r(p+'/package.json').version);"], cwd=target)
            if versions.returncode:
                raise RuntimeError("Cannot identify installed dev tool versions: " + versions.stdout)
            summary["implementation_tools"] = versions.stdout
            expected_versions = "vitest 4.1.12\nconvex 1.49.0\nconvex-test 0.0.52\n@edge-runtime/vm 5.0.0\n"
            if versions.stdout != expected_versions:
                raise RuntimeError("Installed execution tool versions changed; review before repinning")
            results.append(implementation_check(target, output, "implementation-baseline"))
            orders = target / "packages/crm-api/convex/orders.ts"
            original = orders.read_text()
            start = original.index('\t\tconst existing = await ctx.db\n\t\t\t.query("orders")', original.index("export const create = mutation"))
            end = original.index("\n\t\tconst retired", start)
            mutated = original[:start] + "\t\tconst existing = null; // isolated negative control" + original[end:]
            (output / "implementation-mutation.patch").write_text("".join(difflib.unified_diff(
                original.splitlines(True), mutated.splitlines(True), fromfile="orders.ts", tofile="temporary-copy/orders.ts")))
            try:
                orders.write_text(mutated)
                results.append(implementation_check(target, output, "implementation-missing-lookup", mutant=True, bridge_only=True))
            finally:
                orders.write_text(original)
            results.append(implementation_check(target, output, "implementation-restored", bridge_only=True))
        summary["temporary_copy_removed"] = not work.exists()
        if source_snapshot() != summary["sources"]:
            raise RuntimeError("Covered source changed during the run; result invalidated")
        summary["status"] = "pass" if all(result["ok"] for result in summary["results"]) else "failed"
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired, AssertionError) as cause:
        summary["error"] = str(cause)
        summary["status"] = "incomplete"
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Evidence: {output}\nPilot status: {summary['status']}", flush=True)
    if "error" in summary:
        print(summary["error"], flush=True)
    return 0 if summary["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

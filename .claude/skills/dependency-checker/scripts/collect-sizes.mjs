#!/usr/bin/env node
// Collects a deterministic size/type inventory for one package directory.
// Usage: node collect-sizes.mjs <package-dir-relative-to-repo-root>
// Output: strict JSON on stdout — see the shape below.
//
// Why this exists: du + package.json parsing is the same five times over
// (server, client, reviewer-core, e2e, mcp) and is tedious/error-prone to
// hand-roll per run. This script does it once, deterministically, so the
// skill only has to interpret numbers, not compute them.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error("usage: node collect-sizes.mjs <package-dir>");
  process.exit(1);
}

const repoRoot = process.cwd();
const absPkgDir = path.resolve(repoRoot, pkgDir);
const pkgJsonPath = path.join(absPkgDir, "package.json");
if (!existsSync(pkgJsonPath)) {
  console.error(`no package.json at ${pkgJsonPath}`);
  process.exit(1);
}

const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const nodeModules = path.join(absPkgDir, "node_modules");

function duKB(targetPath) {
  try {
    // Some packages here get a flat/hoisted node_modules (real dirs, via
    // .npmrc's node-linker=hoisted — see server/.npmrc, client/.npmrc),
    // others get pnpm's default isolated layout (top-level entries are
    // symlinks into node_modules/.pnpm/...). Resolve the symlink ourselves
    // first, THEN du the real directory with no -L flag. Do not pass -L to
    // du directly on the original path: du -L dereferences every symlink it
    // meets during traversal, including the peer-dependency symlinks nested
    // inside node_modules/.pnpm/*/node_modules/*, which blew up a single
    // package's reported size 2-3x by re-counting shared dependencies once
    // per package that references them.
    const real = realpathSync(targetPath);
    const out = execFileSync("du", ["-sk", real], { encoding: "utf8" });
    return parseInt(out.split("\t")[0], 10);
  } catch {
    return null; // missing, or a broken symlink — caller decides what that means
  }
}

function depDirFor(name) {
  // scoped packages (@scope/name) live under node_modules/@scope/name
  return path.join(nodeModules, ...name.split("/"));
}

function readTsconfigPaths() {
  const tsconfigPath = path.join(absPkgDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return [];
  let raw;
  try {
    // tsconfig.json in this repo may contain // comments — strip line comments
    // before JSON.parse. This is a best-effort strip, not a full JSONC parser.
    raw = readFileSync(tsconfigPath, "utf8").replace(/^\s*\/\/.*$/gm, "");
    raw = raw.replace(/,(\s*[}\]])/g, "$1"); // trailing commas left by stripped lines
  } catch {
    return [];
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return []; // give up quietly; the skill falls back to known aliases from AGENTS.md
  }
  const paths = json.compilerOptions?.paths ?? {};
  return Object.entries(paths)
    .filter(([alias]) => !alias.startsWith(".")) // ignore relative path remaps
    .map(([alias, targets]) => ({
      alias,
      target: targets[0],
      isInternalToThisPackage: !targets[0].startsWith("./node_modules/"),
    }))
    .filter((p) => p.isInternalToThisPackage);
}

function collectDeps(depsObj, type) {
  if (!depsObj) return [];
  return Object.keys(depsObj).map((name) => {
    const dir = depDirFor(name);
    const sizeKB = existsSync(dir) ? duKB(dir) : null;
    return {
      name,
      type,
      versionRange: depsObj[name],
      installed: existsSync(dir),
      sizeKB,
    };
  });
}

const deps = [
  ...collectDeps(pkgJson.dependencies, "prod"),
  ...collectDeps(pkgJson.devDependencies, "dev"),
  ...collectDeps(pkgJson.peerDependencies, "peer"),
];

const totalNodeModulesKB = existsSync(nodeModules) ? duKB(nodeModules) : null;

const result = {
  packageDir: pkgDir,
  packageName: pkgJson.name,
  totalNodeModulesKB,
  depCount: { prod: Object.keys(pkgJson.dependencies ?? {}).length, dev: Object.keys(pkgJson.devDependencies ?? {}).length, peer: Object.keys(pkgJson.peerDependencies ?? {}).length },
  deps: deps.sort((a, b) => (b.sizeKB ?? -1) - (a.sizeKB ?? -1)),
  internalAliases: readTsconfigPaths(),
};

console.log(JSON.stringify(result, null, 2));

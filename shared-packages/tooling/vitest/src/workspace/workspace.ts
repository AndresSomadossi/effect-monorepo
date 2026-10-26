import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type PackageJson, readPackageJson } from "#workspace/package-manifest";

export type WorkspacePackage = { dir: string; manifest: PackageJson };

// Built from a string because the boundaries scanner does not model quotes inside regex literals.
const quote = "[\"']";
const workspaceEntryPattern = new RegExp(`^\\s+-\\s+${quote}?([^"'\\s#]+)${quote}?`);

/** Closest directory at or above `start` that holds pnpm-workspace.yaml. */
export function findRepositoryRoot(start: string): string {
  let directory = start;
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    }
    directory = parent;
  }
  return directory;
}

/** Workspace packages by name, from the `packages:` entries of pnpm-workspace.yaml (plain paths and globs whose `*` segments match one directory level each). */
export function listWorkspacePackages(root: string): Map<string, WorkspacePackage> {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  const entries: string[] = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    if (/^\S/.test(line)) {
      break;
    }
    const entry = workspaceEntryPattern.exec(line)?.[1];
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  // Each `*` segment matches one directory level, so `shared-packages/*/*` lists every package two levels under shared-packages/.
  const expand = (directory: string, segments: readonly string[]): string[] => {
    const [segment, ...rest] = segments;
    if (segment === undefined) {
      return [directory];
    }
    if (segment !== "*") {
      return expand(join(directory, segment), rest);
    }
    if (!existsSync(directory)) {
      return [];
    }
    return readdirSync(directory, { withFileTypes: true })
      .filter((child) => child.isDirectory())
      .flatMap((child) => expand(join(directory, child.name), rest));
  };
  const directories = entries.flatMap((entry) => expand(root, entry.split("/")));
  const packages = new Map<string, WorkspacePackage>();
  for (const dir of directories) {
    if (existsSync(join(dir, "package.json"))) {
      const manifest = readPackageJson(dir);
      packages.set(manifest.name, { dir, manifest });
    }
  }
  return packages;
}

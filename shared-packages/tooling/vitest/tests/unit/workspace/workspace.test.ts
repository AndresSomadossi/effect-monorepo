import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { findRepositoryRoot, listWorkspacePackages, packageDirectoryOf } from "#workspace/index";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("workspace", () => {
  test("findRepositoryRoot finds the directory holding pnpm-workspace.yaml", () => {
    expect(existsSync(join(findRepositoryRoot(packageDirectoryOf(import.meta.url)), "pnpm-workspace.yaml"))).toBe(true);
  });
  test("findRepositoryRoot throws when no workspace file exists above the start", () => {
    const directory = mkdtempSync(join(tmpdir(), "tooling-vitest-"));
    temporaryDirectories.push(directory);
    expect(() => findRepositoryRoot(directory)).toThrow("pnpm-workspace.yaml not found");
  });
  test("listWorkspacePackages lists the real repository packages", () => {
    const packages = listWorkspacePackages(findRepositoryRoot(packageDirectoryOf(import.meta.url)));
    expect(packages.has("@repo/tooling-vitest")).toBe(true);
    expect(packages.has("@repo/sdk-core")).toBe(true);
  });
  test("listWorkspacePackages expands dir/* globs, plain paths and quoted entries, and skips missing parents", () => {
    const root = mkdtempSync(join(tmpdir(), "tooling-vitest-"));
    temporaryDirectories.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "libs/*"\n  - tool\n  - missing/*\ncatalog:\n  - ignored\n');
    for (const [dir, name] of [
      ["libs/a", "@repo/a"],
      ["tool", "@repo/tool"],
    ] as const) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name }));
    }
    mkdirSync(join(root, "libs", "no-manifest"));
    expect([...listWorkspacePackages(root).keys()].sort()).toEqual(["@repo/a", "@repo/tool"]);
  });
});

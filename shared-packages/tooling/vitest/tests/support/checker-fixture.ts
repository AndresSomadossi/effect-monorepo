import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test as baseTest } from "vitest";

import { type BoundaryRules, createBoundaryChecks } from "#package-boundaries/index";
import type { PackageJson } from "#workspace/index";

export type Fixture = {
  root: string;
  packageDirectory: string;
  write: (rel: string, text: string) => void;
  writeManifest: (manifest: Partial<PackageJson>) => void;
  run: (name: string, rules?: Partial<BoundaryRules>) => string[];
  remove: () => void;
};

const baseManifest: PackageJson = {
  name: "@repo/target",
  imports: { "#*": ["./src/*.ts", "./src/*/index.ts"] },
  exports: { ".": "./src/index.ts" },
  devDependencies: { vitest: "catalog:" },
};

export const baseRules: BoundaryRules = { allowedWorkspaceDependencies: {} };

/**
 * A temporary pnpm workspace with the package under test at `packagePath` (default `packages/target`)
 * and a sibling `@repo/sibling` exporting `.` and `./extra`.
 */
export function createFixture({ packagePath = "packages/target" }: { packagePath?: string } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "package-boundaries-"));
  const packageDirectory = join(root, ...packagePath.split("/"));
  const writeAt = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  writeAt(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - contexts/*\n");
  writeAt(join(root, "packages", "sibling", "package.json"), JSON.stringify({ name: "@repo/sibling", exports: { ".": "./src/index.ts", "./extra": "./src/extra.ts" } }));
  const writeManifest = (manifest: Partial<PackageJson>) => writeAt(join(packageDirectory, "package.json"), JSON.stringify({ ...baseManifest, ...manifest }));
  writeManifest({});
  writeAt(join(packageDirectory, "src", "index.ts"), "export const value = 1;\n");
  return {
    root,
    packageDirectory,
    write: (rel, text) => writeAt(join(packageDirectory, rel), text),
    writeManifest,
    run: (name, rules = {}) => {
      const boundaries = createBoundaryChecks({ packageDirectory, rules: { ...baseRules, ...rules } });
      const check = boundaries.checks.find((candidate) => candidate.name === name);
      if (check === undefined) {
        throw new Error(`no check named ${name}`);
      }
      return check.run();
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const allowSibling = (field: keyof BoundaryRules["allowedWorkspaceDependencies"]): Partial<BoundaryRules> => ({ allowedWorkspaceDependencies: { [field]: ["@repo/sibling"] } });

export type MakeFixture = (options?: Parameters<typeof createFixture>[0]) => Fixture;

/**
 * The checker tests' Vitest test (testing.md). `makeFixture` creates a fixture workspace, `fixture` is the default one; every workspace a
 * test created is removed when the test ends.
 */
export const test = baseTest
  // biome-ignore lint/correctness/noEmptyPattern: Vitest reads a fixture's dependencies from its first parameter's destructuring; this one has none.
  .extend("makeFixture", ({}, { onCleanup }): MakeFixture => {
    const created: Fixture[] = [];
    onCleanup(() => {
      for (const workspace of created) {
        workspace.remove();
      }
    });
    return (options) => {
      const workspace = createFixture(options);
      created.push(workspace);
      return workspace;
    };
  })
  .extend("fixture", ({ makeFixture }) => makeFixture());

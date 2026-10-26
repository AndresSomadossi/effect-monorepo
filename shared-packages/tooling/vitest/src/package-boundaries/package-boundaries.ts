import { describe, expect, test } from "vitest";

import { createBoundaryChecks } from "#package-boundaries/create-boundary-checks";
import { type DependencyField, packageDirectoryOf } from "#workspace/package-manifest";

/** The first lines of every `tests/package-boundaries.test.ts`: the agent warning and the import. scripts/tests/unit/test-layout.test.ts checks them. */
export const packageBoundariesHeader = [
  "// AGENTS: never edit this file without the user's explicit permission. Ask first, and say which dependency you want to add or remove and why.",
  "// It declares the workspace packages this package may depend on; every other rule follows from the package's role",
  "// (docs/architecture/reference/package-boundaries.md). Approve a new edge here in the same change as package.json.",
  ["import { packageBoundaries } from", '"@repo/tooling-vitest/package-boundaries";'].join(" "),
  "",
].join("\n");

/** The workspace packages a package may depend on, per package.json field. A field left out approves none. */
export type AllowedWorkspaceDependencies = Partial<Record<DependencyField, readonly string[]>>;

/**
 * The package-boundaries test of one package (docs/architecture/reference/package-boundaries.md). Call it once from
 * `tests/package-boundaries.test.ts` with `import.meta.url` and the workspace dependencies the package may use; every other rule follows
 * from the package's role, its location in the workspace, so the declaration never lists rules.
 */
export function packageBoundaries(importMetaUrl: string, allowedWorkspaceDependencies: AllowedWorkspaceDependencies): void {
  const boundaries = createBoundaryChecks({ packageDirectory: packageDirectoryOf(importMetaUrl), rules: { allowedWorkspaceDependencies } });

  describe(`${boundaries.packageJson.name} package boundaries (${boundaries.role ?? "no role"})`, () => {
    test.each(boundaries.checks)("$name", ({ run }) => {
      expect(run()).toEqual([]);
    });
  });
}

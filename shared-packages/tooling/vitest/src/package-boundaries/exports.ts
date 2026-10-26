import { existsSync } from "node:fs";
import { join } from "node:path";

import { appRole, contextRole, infrastructureRole } from "#package-boundaries/roles";

// package-public-surfaces.md: every package exposes intentional, documented public surfaces. A role with one standard surface gets exactly
// that; any other package may name its subpaths, which target src/, or tests/support/ for a development-only `./testing` subpath.

type StandardExports = { required: Readonly<Record<string, string>>; optional?: Readonly<Record<string, string>>; source: string };

const standardExports: Readonly<Record<string, StandardExports>> = {
  [appRole]: { required: { "./contracts": "./src/contracts/index.ts" }, source: 'app-contracts.md: "App contracts are exposed through one documented subpath: `./contracts`."' },
  [contextRole]: {
    required: { ".": "./src/index.ts" },
    optional: { "./migrations": "./src/migrations.ts", "./testing": "./tests/support/testing.ts" },
    source:
      "package-public-surfaces.md: a context exposes its package root, a context that owns a schema exports its migration set from `./migrations`, and a context whose ports have adapters outside it exports their contract suites from `./testing`",
  },
  [infrastructureRole]: { required: {}, source: 'infrastructure.md: "Infrastructure packages export nothing: deploy workflows read their stack outputs."' },
};

export const exportsCheckName = "exposes only its standard public surfaces";

const isTestingKey = (key: string): boolean => key === "./testing" || key.startsWith("./testing/");

/** Violations of the role's standard exports, or of the general subpath rules when the role has none; every target must exist. */
export function exportsViolations({ packageDirectory, exportsField, role }: { packageDirectory: string; exportsField: unknown; role: string | undefined }): string[] {
  if (typeof exportsField !== "object" || exportsField === null || Array.isArray(exportsField)) {
    // The import checks report a missing or unsupported exports shape.
    return [];
  }
  const entries = Object.entries(exportsField).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const missing = entries.filter(([, target]) => !existsSync(join(packageDirectory, target))).map(([key, target]) => `package.json exports ${key} targets ${target}: no such file`);
  const standard = standardExports[role ?? ""];
  if (standard === undefined) {
    return [
      ...entries
        .filter(([key, target]) => (isTestingKey(key) ? !target.startsWith("./tests/support/") : !target.startsWith("./src/")))
        .map(([key, target]) => `package.json exports ${key} targets ${target}: ${isTestingKey(key) ? "a ./testing subpath targets tests/support/" : "public subpaths target src/"}`),
      ...missing,
    ];
  }
  const allowed: Readonly<Record<string, string>> = { ...standard.required, ...standard.optional };
  return [
    ...Object.entries(standard.required)
      .filter(([key]) => !entries.some((entry) => entry[0] === key))
      .map(([key, target]) => `package.json exports is missing ${key}: ${target} (${standard.source})`),
    ...entries.filter(([key, target]) => allowed[key] !== target).map(([key, target]) => `package.json exports ${key}: ${target} is not a standard subpath (${standard.source})`),
    ...missing,
  ];
}

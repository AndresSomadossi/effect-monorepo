import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { isSkippedDirectory } from "#package-boundaries/source-scan";

// Migration metadata: docs/architecture/reference/delivery-workflows.md ("Every migration must have machine-readable metadata before merge.")
// and persistence.md (a Postgres adapter's migrations and their manifest.json live in the adapter's folder, beside its migration set).

export const migrationsCheckName = "classifies every migration in its migrations/manifest.json";

/** delivery-workflows.md Migration Phases. Anything else, including a missing phase, blocks. */
export const migrationPhases = ["before-code", "with-code", "after-code", "manual"] as const;

const idPattern = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/;

const readManifestEntries = (path: string): unknown[] | undefined => {
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { migrations?: unknown };
    return Array.isArray(manifest.migrations) ? manifest.migrations : undefined;
  } catch {
    return undefined;
  }
};

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function entryProblems(entries: readonly unknown[], manifestRel: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, entry] of entries.entries()) {
    const fields = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const id = isNonEmptyString(fields.id) ? fields.id : `entry ${index}`;
    const at = `${manifestRel} ${id}`;
    if (!isNonEmptyString(fields.id) || !idPattern.test(fields.id)) {
      problems.push(`${at}: id must be <14-digit UTC timestamp>_<snake_case description>`);
    } else if (seen.has(id)) {
      problems.push(`${at}: listed more than once`);
    } else if (previous !== undefined && id < previous) {
      problems.push(`${at}: listed after ${previous}; list migrations in id order`);
    }
    seen.add(id);
    previous = previous === undefined || id > previous ? id : previous;
    for (const field of ["issue", "description"] as const) {
      if (!isNonEmptyString(fields[field])) {
        problems.push(`${at}: ${field} must be a non-empty string`);
      }
    }
    if (!(migrationPhases as readonly unknown[]).includes(fields.phase)) {
      problems.push(`${at}: phase must be one of ${migrationPhases.join(", ")}`);
    }
  }
  return problems;
}

// Every directory named migrations/ under src/, such as src/outbound/invoice-repository/postgres/migrations.
function migrationDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isSkippedDirectory(entry.name))
    .flatMap((entry) => (entry.name === "migrations" ? [join(directory, entry.name)] : migrationDirectories(join(directory, entry.name))));
}

function directoryViolations(directory: string, directoryRel: string): string[] {
  const manifestRel = `${directoryRel}/manifest.json`;
  const files = readdirSync(directory, { withFileTypes: true }).filter((file) => file.name !== ".DS_Store");
  const strays = files.filter((file) => !(file.isFile() && (file.name === "manifest.json" || file.name.endsWith(".sql")))).map((file) => `${directoryRel}/${file.name}: migrations/ holds only <id>.sql files and manifest.json`);
  const entries = readManifestEntries(join(directory, "manifest.json"));
  if (entries === undefined) {
    return [`${manifestRel}: missing or not valid JSON`, ...strays];
  }
  const fileIds = new Set(files.filter((file) => file.isFile() && file.name.endsWith(".sql")).map((file) => file.name.slice(0, -".sql".length)));
  const entryIds = new Set(entries.map((entry) => (entry as { id?: unknown } | null)?.id).filter(isNonEmptyString));
  const unlisted = [...fileIds].filter((id) => !entryIds.has(id)).map((id) => `${directoryRel}/${id}.sql: has no entry in ${manifestRel}`);
  const missingFiles = [...entryIds].filter((id) => !fileIds.has(id)).map((id) => `${manifestRel} ${id}: has no ${directoryRel}/${id}.sql`);
  return [...unlisted, ...missingFiles, ...entryProblems(entries, manifestRel), ...strays];
}

/**
 * Problems with each `migrations/` directory under a package's src/: every `<id>.sql` file needs exactly one manifest entry with its id,
 * issue, a known phase and a description, entries are listed in id order, and every entry has its file. A package without one passes.
 */
export function migrationViolations(packageDirectory: string): string[] {
  const source = join(packageDirectory, "src");
  if (!existsSync(source)) {
    return [];
  }
  return migrationDirectories(source)
    .flatMap((directory) => directoryViolations(directory, relative(packageDirectory, directory).split(sep).join("/")))
    .sort();
}

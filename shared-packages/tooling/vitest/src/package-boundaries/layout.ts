import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { matchesPathPattern } from "#package-boundaries/path-pattern";
import { isSkippedDirectory } from "#package-boundaries/source-scan";

// Package Layout standard: docs/architecture/reference/package-public-surfaces.md.

/** Root directories that may hold any content. */
export const layoutRootDirectories: readonly string[] = ["src", "tests"];

/**
 * Root directories a workspace role adds. infrastructure.md: an infrastructure package keeps the provider SDKs `pulumi package add`
 * generates in `sdks/`. A context adds none: persistence.md puts a Postgres adapter's `migrations/` in the adapter's folder under src/.
 */
export const layoutRoleRootDirectories: Readonly<Record<string, readonly string[]>> = { infrastructure: ["sdks"] };

/** Root files a workspace role adds. infrastructure.md: a Pulumi project's `Pulumi.yaml` and one `Pulumi.<stack>.yaml` per stack. */
export const layoutRoleRootFilePatterns: Readonly<Record<string, readonly string[]>> = { infrastructure: ["Pulumi.yaml", "Pulumi.*.yaml"] };

/** Root files allowed next to src/ and tests/. */
export const layoutRootFilePatterns: readonly string[] = [
  "package.json",
  "tsconfig.json",
  "tsconfig.*.json",
  ...["ts", "mts", "cts", "js", "mjs", "cjs", "json"].map((extension) => `*.config.${extension}`),
  "next-env.d.ts",
  "README.md",
  "CHANGELOG.md",
  "turbo.json",
  ".env.example",
  ".env.*.example",
  // Deployable packages: containers.md. BuildKit reads `<Dockerfile name>.dockerignore` beside the Dockerfile.
  "Dockerfile",
  "Dockerfile.dockerignore",
];

/** Gitignored OS and cache noise, ignored anywhere in the package. */
export const layoutIgnoredFilePatterns: readonly string[] = [".DS_Store", "Thumbs.db", "*.tsbuildinfo", ".env", ".env.*"];

const layoutMessage = "files must live in src/ or tests/ (see package-public-surfaces.md Package Layout)";
const dockerignoreMessage = "a package .dockerignore is never read when the build context is the repository root; use Dockerfile.dockerignore (see containers.md)";

function isIgnoredFile(name: string): boolean {
  if (name.startsWith(".env") && name.endsWith(".example")) {
    return false;
  }
  return layoutIgnoredFilePatterns.some((pattern) => matchesPathPattern(name, pattern));
}

function isAllowedRootFile(name: string, role: string | undefined): boolean {
  return [...layoutRootFilePatterns, ...(role === undefined ? [] : (layoutRoleRootFilePatterns[role] ?? []))].some((pattern) => matchesPathPattern(name, pattern));
}

// Symlinks are neither walked nor reported here; the symlink check reports them.
function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return isSkippedDirectory(entry.name) ? [] : listFiles(path);
    }
    return entry.isFile() && !isIgnoredFile(entry.name) ? [path] : [];
  });
}

/** Files outside src/, tests/, the role's root directories and the allowed root files, skipping build output, tool caches and ignored noise. */
export function layoutViolations(packageDirectory: string, { role }: { role?: string | undefined } = {}): string[] {
  const rootDirectories = [...layoutRootDirectories, ...(role === undefined ? [] : (layoutRoleRootDirectories[role] ?? []))];
  const toRel = (path: string) => relative(packageDirectory, path).split(sep).join("/");
  return readdirSync(packageDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(packageDirectory, entry.name);
      if (entry.isDirectory()) {
        return isSkippedDirectory(entry.name) || rootDirectories.includes(entry.name) ? [] : listFiles(path);
      }
      return entry.isFile() && !isIgnoredFile(entry.name) && !isAllowedRootFile(entry.name, role) ? [path] : [];
    })
    .map((path) => toRel(path))
    .map((rel) => `${rel}: ${rel.split("/").at(-1) === ".dockerignore" ? dockerignoreMessage : layoutMessage}`)
    .sort();
}

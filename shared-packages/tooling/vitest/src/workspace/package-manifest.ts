import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DependencyField = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";

export type PackageJson = {
  name: string;
  version?: string;
  exports?: unknown;
  imports?: unknown;
  scripts?: Record<string, string>;
} & Partial<Record<DependencyField, Record<string, string>>>;

export const dependencyFields: readonly DependencyField[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Package root of a file anywhere below it, such as `<package>/tests/unit/x.test.ts`: the nearest directory with a package.json. Pass `import.meta.url`. */
export function packageDirectoryOf(importMetaUrl: string): string {
  let directory = dirname(fileURLToPath(importMetaUrl));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`no package.json above ${fileURLToPath(importMetaUrl)}`);
    }
    directory = parent;
  }
  return directory;
}

export function readPackageJson(directory: string): PackageJson {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as PackageJson;
}

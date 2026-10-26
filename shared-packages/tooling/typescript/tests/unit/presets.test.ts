import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

import { type PackageJson, packageDirectoryOf, readPackageJson } from "@repo/tooling-vitest/workspace";

const packageDirectory = packageDirectoryOf(import.meta.url);
const packageJson = readPackageJson(packageDirectory) as PackageJson & { exports: Record<string, string>; files: string[] };
const presetNames = ["base", "backend", "frontend", "frontend-next", "frontend-lib", "internal-package"];
const exportTargets = Object.values(packageJson.exports).map((target) => join(packageDirectory, target));

describe("typescript config presets", () => {
  test("exports the supported preset names", () => {
    expect(Object.keys(packageJson.exports)).toEqual(presetNames.map((name) => `./${name}`));
  });

  test("every export maps to its preset under ./src", () => {
    const mismatched = Object.entries(packageJson.exports).filter(([key, target]) => target !== `./src/${key.slice(2)}.json`);
    expect(mismatched).toEqual([]);
  });

  test("files ships every exported preset", () => {
    expect(packageJson.files).toEqual(["src/*.json"]);
  });

  test("every exported preset exists and is valid JSON", () => {
    const missing = exportTargets.filter((target) => !existsSync(target));
    expect(missing).toEqual([]);
    for (const target of exportTargets) {
      expect(() => JSON.parse(readFileSync(target, "utf8"))).not.toThrow();
    }
  });

  test("every relative extends in a preset resolves to an existing file", () => {
    const unresolved = exportTargets
      .filter((target) => existsSync(target))
      .flatMap((target) => {
        const preset = JSON.parse(readFileSync(target, "utf8")) as { extends?: string };
        if (preset.extends === undefined || !preset.extends.startsWith(".")) {
          return [];
        }
        const extended = join(dirname(target), preset.extends);
        return existsSync(extended) ? [] : [`${target} -> ${preset.extends}`];
      });
    expect(unresolved).toEqual([]);
  });
});

import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { packageDirectoryOf, readPackageJson } from "#workspace/index";

describe("package manifest", () => {
  test("packageDirectoryOf resolves the package root from a test file nested under tests/", () => {
    expect(packageDirectoryOf(import.meta.url)).toMatch(new RegExp(`${join("shared-packages", "tooling", "vitest")}$`));
  });
  test("readPackageJson reads the package.json of a directory", () => {
    expect(readPackageJson(packageDirectoryOf(import.meta.url)).name).toBe("@repo/tooling-vitest");
  });
});

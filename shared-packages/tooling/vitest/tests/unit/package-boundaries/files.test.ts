import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { test } from "../../support/checker-fixture.ts";

describe("file checks", () => {
  test("A1 reports symlinks inside the package but not inside node_modules", ({ fixture }) => {
    symlinkSync(join(fixture.root, "packages", "sibling"), join(fixture.packageDirectory, "src", "linked"), "dir");
    mkdirSync(join(fixture.packageDirectory, "node_modules", "@repo"), { recursive: true });
    symlinkSync(join(fixture.root, "packages", "sibling"), join(fixture.packageDirectory, "node_modules", "@repo", "sibling"), "dir");
    expect(fixture.run("contains no symlinks")).toEqual(["src/linked: symlinks are not allowed inside a package"]);
  });

  test("A2 requires @types/node for types=node", ({ fixture }) => {
    fixture.write("src/a.ts", '/// <reference types="node" />\nexport {};\n');
    expect(fixture.run("declares every package it imports")).toEqual(["src/a.ts references types node: @types/node is not declared in package.json"]);
    fixture.writeManifest({ devDependencies: { vitest: "catalog:", "@types/node": "catalog:" } });
    expect(fixture.run("declares every package it imports")).toEqual([]);
  });

  test("A2 accepts other type references only from a field the file may use, by name or @types package", ({ fixture }) => {
    fixture.write("tests/a.test.ts", '/// <reference types="vitest/globals" />\n');
    fixture.write("src/a.ts", '/// <reference types="vitest" />\n/// <reference types="@scope/pkg" />\n/// <reference types="missing" />\n');
    fixture.writeManifest({ dependencies: { "@types/scope__pkg": "^1.0.0" } });
    expect(fixture.run("declares every package it imports")).toEqual(["src/a.ts references types vitest: vitest is only a devDependency", "src/a.ts references types missing: missing is not declared in package.json"]);
  });

  test("A2 checks @repo type references against workspace rules", ({ fixture }) => {
    fixture.write("src/a.ts", '/// <reference types="@repo/other" />\n');
    expect(fixture.run("imports other workspace packages only through their exports")).toEqual(["src/a.ts imports @repo/other: @repo/other is not an allowed workspace dependency of @repo/target"]);
  });

  test("A4 treats next.config.* as runtime code and other root config files as development files", ({ fixture }) => {
    fixture.write("next.config.ts", 'import { defineConfig } from "vitest/config";\n');
    fixture.write("vitest.config.ts", 'import { defineConfig } from "vitest/config";\n');
    expect(fixture.run("declares every package it imports")).toEqual(["next.config.ts imports vitest/config: vitest is only a devDependency"]);
  });
});

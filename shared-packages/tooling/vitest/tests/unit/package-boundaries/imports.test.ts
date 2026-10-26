import { describe, expect } from "vitest";

import { allowSibling, test } from "../../support/checker-fixture.ts";

describe("import checks", () => {
  test("a clean package passes every check", ({ fixture }) => {
    fixture.write("tests/x.test.ts", 'import { test } from "vitest";\nimport { value } from "../src/index";\n');
    for (const name of [
      "declares only allowed workspace dependencies",
      "imports other workspace packages only through their exports",
      "keeps relative imports inside the package",
      "declares every package it imports",
      "does not use the Result backing library directly",
      "uses only exported tsconfig presets and no path aliases",
      "maps subpath imports only into its own src",
      "contains no symlinks",
      "keeps tsconfig include, exclude and files inside the package",
    ]) {
      expect(fixture.run(name), name).toEqual([]);
    }
  });

  test("U2 reports unapproved packages, deep src imports, unknown export keys and dev-only use at runtime", ({ fixture }) => {
    fixture.writeManifest({ dependencies: { "@repo/sibling": "workspace:^" } });
    fixture.write("src/a.ts", 'import "@repo/other";\nimport "@repo/sibling/src/extra";\nimport "@repo/sibling/missing";\nimport "@repo/sibling/extra";\n');
    expect(fixture.run("imports other workspace packages only through their exports", allowSibling("dependencies"))).toEqual([
      "src/a.ts imports @repo/other: @repo/other is not an allowed workspace dependency of @repo/target",
      "src/a.ts imports @repo/sibling/src/extra: deep import into src/",
      "src/a.ts imports @repo/sibling/missing: ./missing is not an exports key of @repo/sibling",
    ]);
    fixture.writeManifest({ devDependencies: { "@repo/sibling": "workspace:^" } });
    fixture.write("src/a.ts", 'import "@repo/sibling";\n');
    expect(fixture.run("imports other workspace packages only through their exports", allowSibling("devDependencies"))).toEqual(["src/a.ts imports @repo/sibling: @repo/sibling is only a devDependency"]);
  });

  test("U3 reports relative imports that leave the package or enter node_modules, and absolute imports", ({ fixture }) => {
    fixture.write("src/a.ts", 'import "../../sibling/src/index";\nimport "./node_modules/x/index";\nimport "/tmp/x";\nimport "./index";\n');
    expect(fixture.run("keeps relative imports inside the package")).toEqual([
      "src/a.ts imports ../../sibling/src/index: relative import leaves the package",
      "src/a.ts imports ./node_modules/x/index: relative import into node_modules",
      "src/a.ts imports /tmp/x: absolute paths bypass package boundaries",
    ]);
  });

  test("U4 reports undeclared packages and dev-only packages at runtime", ({ fixture }) => {
    fixture.write("src/a.ts", 'import "left-pad";\nimport { test } from "vitest";\nimport "node:fs";\n');
    fixture.write("tests/a.test.ts", 'import { test } from "vitest";\n');
    expect(fixture.run("declares every package it imports")).toEqual(["src/a.ts imports vitest: vitest is only a devDependency", "src/a.ts imports left-pad: left-pad is not declared in package.json"]);
  });

  test("U5 reports the Result backing library unless the package is @repo/sdk-core, which owns it", ({ fixture }) => {
    fixture.writeManifest({ dependencies: { neverthrow: "catalog:" } });
    fixture.write("src/a.ts", 'import { ok } from "neverthrow";\n');
    expect(fixture.run("does not use the Result backing library directly")).toEqual(["package.json dependencies declares neverthrow: import Result from @repo/sdk-core", "src/a.ts imports neverthrow: import Result from @repo/sdk-core"]);
    fixture.writeManifest({ name: "@repo/sdk-core", dependencies: { neverthrow: "catalog:" } });
    expect(fixture.run("owns the Result backing library")).toEqual([]);
  });

  test("ignores imports inside comments and keeps scanning after // inside strings", ({ fixture }) => {
    fixture.write("src/a.ts", '// import "left-pad";\n/* import "right-pad"; */\nconst url = "https://example.com"; import "up-pad";\nconst kinds = ["import", "subpath-import"];\n');
    expect(fixture.run("declares every package it imports")).toEqual(["src/a.ts imports up-pad: up-pad is not declared in package.json"]);
  });

  test("detects dynamic imports, re-exports, vi.mock and require", ({ fixture }) => {
    fixture.write("src/a.ts", 'export { a } from "a-pkg";\nawait import("b-pkg");\nrequire("c-pkg");\n');
    fixture.write("tests/a.test.ts", 'vi.mock("d-pkg");\n');
    expect(fixture.run("declares every package it imports")).toEqual([
      "src/a.ts imports a-pkg: a-pkg is not declared in package.json",
      "src/a.ts imports b-pkg: b-pkg is not declared in package.json",
      "src/a.ts imports c-pkg: c-pkg is not declared in package.json",
      "tests/a.test.ts imports d-pkg: d-pkg is not declared in package.json",
    ]);
  });

  test("scanExclude skips matching files", ({ fixture }) => {
    fixture.write("tests/fixtures/a.ts", 'import "left-pad";\n');
    fixture.write("tests/other.ts", 'import "right-pad";\n');
    expect(fixture.run("declares every package it imports", { scanExclude: ["tests/fixtures/**"] })).toEqual(["tests/other.ts imports right-pad: right-pad is not declared in package.json"]);
  });
});

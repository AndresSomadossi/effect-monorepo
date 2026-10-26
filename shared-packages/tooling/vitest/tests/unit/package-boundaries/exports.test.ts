import { describe, expect } from "vitest";

import { test } from "../../support/checker-fixture.ts";

const exportsCheck = "exposes only its standard public surfaces";

describe("standard exports", () => {
  test("an app exposes exactly its contracts subpath", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "apps/target" });
    fixture.write("src/contracts/index.ts", "export {};\n");
    fixture.writeManifest({ exports: { "./contracts": "./src/contracts/index.ts" } });
    expect(fixture.run(exportsCheck)).toEqual([]);

    fixture.writeManifest({ exports: { ".": "./src/index.ts" } });
    expect(fixture.run(exportsCheck)).toEqual([
      'package.json exports is missing ./contracts: ./src/contracts/index.ts (app-contracts.md: "App contracts are exposed through one documented subpath: `./contracts`.")',
      'package.json exports .: ./src/index.ts is not a standard subpath (app-contracts.md: "App contracts are exposed through one documented subpath: `./contracts`.")',
    ]);
  });

  test("a context exposes its root and may expose its migration set and its contract suites, nothing else", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/target" });
    fixture.write("src/migrations.ts", "export {};\n");
    fixture.write("tests/support/testing.ts", "export {};\n");
    fixture.writeManifest({ exports: { ".": "./src/index.ts", "./migrations": "./src/migrations.ts", "./testing": "./tests/support/testing.ts" } });
    expect(fixture.run(exportsCheck)).toEqual([]);

    fixture.writeManifest({ exports: { ".": "./src/index.ts", "./testing": "./tests/support/contracts/other.ts" } });
    expect(fixture.run(exportsCheck).map((violation) => violation.split(" (")[0])).toEqual([
      "package.json exports ./testing: ./tests/support/contracts/other.ts is not a standard subpath",
      "package.json exports ./testing targets ./tests/support/contracts/other.ts: no such file",
    ]);

    fixture.writeManifest({ exports: { ".": "./src/index.ts", "./schema": "./src/schema.ts" } });
    expect(fixture.run(exportsCheck).map((violation) => violation.split(" (")[0])).toEqual(["package.json exports ./schema: ./src/schema.ts is not a standard subpath", "package.json exports ./schema targets ./src/schema.ts: no such file"]);
  });

  test("an infrastructure package exports nothing", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "infrastructure/target" });
    expect(fixture.run(exportsCheck).map((violation) => violation.split(" (")[0])).toEqual(["package.json exports .: ./src/index.ts is not a standard subpath"]);
  });

  test("other packages target src/, or tests/support/ from a ./testing subpath, and only files that exist", ({ fixture }) => {
    fixture.write("tests/support/in-memory.ts", "export {};\n");
    fixture.write("tests/support/other.ts", "export {};\n");
    fixture.writeManifest({ exports: { ".": "./src/index.ts", "./testing": "./tests/support/in-memory.ts", "./extra": "./tests/support/other.ts", "./missing": "./src/missing.ts" } });

    expect(fixture.run(exportsCheck)).toEqual(["package.json exports ./extra targets ./tests/support/other.ts: public subpaths target src/", "package.json exports ./missing targets ./src/missing.ts: no such file"]);
  });
});

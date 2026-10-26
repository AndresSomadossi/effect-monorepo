import { describe, expect } from "vitest";

import { allowSibling, test } from "../../support/checker-fixture.ts";

describe("manifest and tsconfig checks", () => {
  test("U1 compares the rules with package.json both ways and rejects non-range values", ({ fixture }) => {
    fixture.writeManifest({ dependencies: { "@repo/sibling": "workspace:^", "left-pad": "file:../left-pad" } });
    expect(fixture.run("declares only allowed workspace dependencies")).toEqual([
      "package.json dependencies declares @repo/sibling: not an allowed workspace dependency of @repo/target",
      "package.json dependencies left-pad uses file:../left-pad: only semver ranges, catalog: and workspace: ranges are allowed",
    ]);
    fixture.writeManifest({});
    expect(fixture.run("declares only allowed workspace dependencies", allowSibling("devDependencies"))).toEqual(["package.json devDependencies is missing allowed @repo/sibling: update tests/package-boundaries.test.ts or package.json"]);
  });

  test("U6 reports unapproved or unexported presets, escaping extends and path aliases", ({ fixture }) => {
    fixture.write("tsconfig.json", JSON.stringify({ extends: ["@repo/sibling/missing", "@repo/other/base", "../../tsconfig.json", "./local.json"], compilerOptions: { paths: {} } }));
    fixture.writeManifest({ devDependencies: { "@repo/sibling": "workspace:^" } });
    expect(fixture.run("uses only exported tsconfig presets and no path aliases", allowSibling("devDependencies"))).toEqual([
      "tsconfig.json extends @repo/sibling/missing: ./missing is not an exports key of @repo/sibling",
      "tsconfig.json extends @repo/other/base: @repo/other is not an allowed workspace dependency of @repo/target",
      "tsconfig.json extends ../../tsconfig.json: relative extends leaves the package",
      "tsconfig.json compilerOptions.paths is not allowed: it can alias another package's internals",
    ]);
  });

  test("U7 keeps subpath imports inside src", ({ fixture }) => {
    fixture.writeManifest({ imports: { "#a": "./lib/a.ts", "#b": ["./src/../b.ts"], "#c": "./src/c.ts" } });
    expect(fixture.run("maps subpath imports only into its own src")).toEqual([
      "package.json imports #a targets ./lib/a.ts: imports must map into ./src/",
      "package.json imports #b targets ./src/../b.ts: target segments must not contain .. or node_modules",
    ]);
  });

  test("A3 keeps tsconfig include, exclude and files inside the package", ({ fixture }) => {
    fixture.write("tsconfig.json", JSON.stringify({ include: ["src/**/*.ts", "../other/**"], exclude: ["/tmp/**"], files: ["next-env.d.ts"] }));
    fixture.write("tests/tsconfig.json", JSON.stringify({ include: ["./**/*.ts", "../src/**/*.ts", "../../sibling/src/*.ts"] }));
    expect(fixture.run("keeps tsconfig include, exclude and files inside the package")).toEqual([
      "tsconfig.json include ../other/**: entry leaves the package",
      "tsconfig.json exclude /tmp/**: absolute paths are not allowed",
      "tests/tsconfig.json include ../../sibling/src/*.ts: entry leaves the package",
    ]);
  });
});

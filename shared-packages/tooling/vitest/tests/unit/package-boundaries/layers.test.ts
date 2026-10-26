import { describe, expect } from "vitest";

import { type CodeRule, hasLeadingDirective, type LayerRule, matchesLayerPattern, normalizeModulePath } from "#package-boundaries/index";
import { type Fixture, test } from "../../support/checker-fixture.ts";

const run = (fixture: Fixture, rule: LayerRule, extra = {}) => fixture.run(rule.name, { internalLayers: [rule], ...extra });

describe("layer patterns", () => {
  test("match extensionless paths, index files and the directory itself", () => {
    expect(normalizeModulePath("src/a/index.tsx")).toBe("src/a");
    expect(matchesLayerPattern("src/composition/index.ts", "src/composition/**")).toBe(true);
    expect(matchesLayerPattern("src/composition", "src/composition/**")).toBe(true);
    expect(matchesLayerPattern("src/composition-x/a.ts", "src/composition/**")).toBe(false);
    expect(matchesLayerPattern("src/main.ts", "src/main.ts")).toBe(true);
    expect(matchesLayerPattern("src/a/b/c.ts", "src/*/c.ts")).toBe(false);
  });

  test("detect a leading directive after comments only", () => {
    expect(hasLeadingDirective('// note\n/* x */\n"use client";\n', "use client")).toBe(true);
    expect(hasLeadingDirective("'use client'\n", "use client")).toBe(true);
    expect(hasLeadingDirective('import x from "y";\n"use client";\n', "use client")).toBe(false);
  });
});

describe("layer rules", () => {
  const noComposition: LayerRule = { name: "no composition", source: "doc.md", from: ["src/**"], except: ["src/main.ts", "src/composition/**"], mayNotImport: ["src/composition/**"] };

  test("mayNotImport resolves # imports through the package imports map", ({ fixture }) => {
    fixture.write("src/inbound/a.ts", 'import { x } from "#composition/local";\n');
    fixture.write("src/main.ts", 'import { x } from "#composition/local";\n');
    fixture.write("src/composition/local.ts", 'import { y } from "#composition/config";\n');
    expect(run(fixture, noComposition)).toEqual(["src/inbound/a.ts imports #composition/local: no composition (doc.md)"]);
  });

  test("mayNotImport resolves relative imports and directory index imports", ({ fixture }) => {
    fixture.write("src/inbound/a.ts", 'import { x } from "../composition/local.ts";\nimport { y } from "../composition";\n');
    expect(run(fixture, noComposition)).toEqual(["src/inbound/a.ts imports ../composition/local.ts: no composition (doc.md)", "src/inbound/a.ts imports ../composition: no composition (doc.md)"]);
  });

  test("rules apply to src files only", ({ fixture }) => {
    fixture.write("tests/a.test.ts", 'import { x } from "#composition/local";\n');
    expect(run(fixture, noComposition)).toEqual([]);
  });

  test("mayImportOnly constrains internal targets and leaves bare packages alone", ({ fixture }) => {
    const rule: LayerRule = { name: "contracts only", source: "doc.md", from: ["src/contracts/**"], mayImportOnly: ["src/contracts/**"] };
    fixture.write("src/contracts/a.ts", 'import { z } from "zod";\nimport { b } from "./b";\nimport { c } from "#inbound/c";\nimport { d } from "../d";\n');
    expect(run(fixture, rule)).toEqual(["src/contracts/a.ts imports #inbound/c: contracts only (doc.md)", "src/contracts/a.ts imports ../d: contracts only (doc.md)"]);
  });

  test("package: patterns match bare packages by name", ({ fixture }) => {
    const rule: LayerRule = { name: "no frameworks", source: "doc.md", from: ["src/contracts/**"], mayNotImport: ["package:fastify", "package:next"] };
    fixture.write("src/contracts/a.ts", 'import fastify from "fastify";\nimport { b } from "next/server";\nimport { z } from "zod";\n');
    expect(run(fixture, rule)).toEqual(["src/contracts/a.ts imports fastify: no frameworks (doc.md)", "src/contracts/a.ts imports next/server: no frameworks (doc.md)"]);
  });

  test("fromDirective applies a rule only to files with the directive", ({ fixture }) => {
    const rule: LayerRule = { name: "client", source: "doc.md", from: ["src/**"], fromDirective: "use client", mayNotImport: ["src/composition/**", "package.json"] };
    fixture.write("src/components/a.tsx", '"use client";\nimport { x } from "../composition/app-identity";\nimport manifest from "../../package.json";\n');
    fixture.write("src/components/b.tsx", 'import { x } from "../composition/app-identity";\n');
    expect(run(fixture, rule)).toEqual(["src/components/a.tsx imports ../composition/app-identity: client (doc.md)", "src/components/a.tsx imports ../../package.json: client (doc.md)"]);
  });

  test("process.env is allowed only in the listed files, ignoring comments", ({ fixture }) => {
    fixture.write("src/composition/config.ts", "export const port = process.env.PORT;\n");
    fixture.write("src/inbound/a.ts", "export const x = process.env.X;\n");
    fixture.write("src/inbound/b.ts", "// process.env.X is read in composition\nexport {};\n");
    fixture.write("tests/a.test.ts", "process.env.X;\n");
    expect(fixture.run("reads process.env only in composition config", { processEnvAllowedIn: ["src/composition/config.ts"] })).toEqual(["src/inbound/a.ts reads process.env: only src/composition/config.ts may read runtime config"]);
  });
});

describe("code rules", () => {
  const noNative: CodeRule = { name: "no native", source: "doc.md", from: ["src/**"], except: ["src/inbound/node-http/**"], mayNotMatch: /\bnative\b/ };
  const run = (fixture: Fixture, rule: CodeRule) => fixture.run(rule.name, { codeRules: [rule] });

  test("report each match with its line, outside excepted files, ignoring comments and non-src files", ({ fixture }) => {
    fixture.write("src/inbound/api/a.ts", "export const a = (ctx) =>\n  ctx.native.headers;\n// ctx.native in a comment\nexport const b = ({ native }) => native;\n");
    fixture.write("src/inbound/node-http/a.ts", "export const a = (ctx) => ctx.native.socket;\n");
    fixture.write("src/inbound/api/c.ts", "export const nativeLanguage = 'es';\n");
    fixture.write("tests/a.test.ts", "ctx.native;\n");
    expect(run(fixture, noNative)).toEqual(["src/inbound/api/a.ts:2 uses native: no native (doc.md)", "src/inbound/api/a.ts:4 uses native: no native (doc.md)", "src/inbound/api/a.ts:4 uses native: no native (doc.md)"]);
  });

  test("catch computed access through a string literal", ({ fixture }) => {
    fixture.write("src/inbound/api/a.ts", 'export const a = (ctx) => ctx["native"];\n');
    expect(run(fixture, noNative)).toEqual(["src/inbound/api/a.ts:1 uses native: no native (doc.md)"]);
  });
});

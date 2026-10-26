import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { test } from "../../support/checker-fixture.ts";

const layout = "keeps files in the standard package layout";
const suffix = "files must live in src/ or tests/ (see package-public-surfaces.md Package Layout)";

describe("package layout", () => {
  test("reports source files at the package root", ({ fixture }) => {
    fixture.write("index.ts", "export {};\n");
    fixture.write("base.json", "{}\n");
    expect(fixture.run(layout)).toEqual([`base.json: ${suffix}`, `index.ts: ${suffix}`]);
  });

  test("reports files in root directories other than src and tests", ({ fixture }) => {
    fixture.write("tools/x.ts", "export {};\n");
    expect(fixture.run(layout)).toEqual([`tools/x.ts: ${suffix}`]);
  });

  test("accepts the allowed root files and any content under src and tests", ({ fixture }) => {
    for (const rel of [
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "next.config.mjs",
      "biome.config.json",
      "next-env.d.ts",
      "README.md",
      "CHANGELOG.md",
      "turbo.json",
      ".env.example",
      ".env.local.example",
      "Dockerfile",
      "Dockerfile.dockerignore",
      "src/deep/data.json",
      "tests/fixtures/notes.md",
    ]) {
      fixture.write(rel, "{}\n");
    }
    expect(fixture.run(layout)).toEqual([]);
  });

  test("reports a .dockerignore in the package, which a repository-root build context never reads", ({ fixture }) => {
    fixture.write(".dockerignore", "node_modules\n");
    fixture.write("docker/.dockerignore", "node_modules\n");
    const dockerignore = "a package .dockerignore is never read when the build context is the repository root; use Dockerfile.dockerignore (see containers.md)";
    expect(fixture.run(layout)).toEqual([`.dockerignore: ${dockerignore}`, `docker/.dockerignore: ${dockerignore}`]);
  });

  test("reports Dockerfile variants other than the package Dockerfile", ({ fixture }) => {
    fixture.write("Dockerfile.dev", "FROM scratch\n");
    expect(fixture.run(layout)).toEqual([`Dockerfile.dev: ${suffix}`]);
  });

  test("ignores OS and cache noise and skips build output", ({ fixture }) => {
    for (const rel of [".DS_Store", "Thumbs.db", "tsconfig.tsbuildinfo", ".env", ".env.local", "tools/.DS_Store", "node_modules/x/index.js", ".next/server/page.js", ".turbo/log.txt", "dist/index.js", "dist-types/index.d.ts", "coverage/lcov.info"]) {
      fixture.write(rel, "x\n");
    }
    mkdirSync(join(fixture.packageDirectory, "empty"));
    expect(fixture.run(layout)).toEqual([]);
  });

  test("lets an infrastructure package keep its Pulumi project files and generated SDKs", ({ makeFixture }) => {
    const infrastructure = makeFixture({ packagePath: "infrastructure/supabase-invoicing" });
    for (const rel of ["Pulumi.yaml", "Pulumi.staging.yaml", "Pulumi.prod.yaml", "sdks/supabase/project.ts", "sdks/supabase/package.json"]) {
      infrastructure.write(rel, "x\n");
    }
    expect(infrastructure.run(layout)).toEqual([]);
  });

  test("keeps Pulumi project files and sdks/ to infrastructure packages", ({ fixture }) => {
    fixture.write("Pulumi.yaml", "name: x\n");
    fixture.write("sdks/supabase/project.ts", "export {};\n");
    expect(fixture.run(layout)).toEqual([`Pulumi.yaml: ${suffix}`, `sdks/supabase/project.ts: ${suffix}`]);
  });
});

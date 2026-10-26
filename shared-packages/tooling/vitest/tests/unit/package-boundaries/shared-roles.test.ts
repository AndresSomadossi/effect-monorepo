import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { type Fixture, test } from "../../support/checker-fixture.ts";

// The fixture workspace plus a package of every role next to the package under test.
const withNeighbours = (current: Fixture): Fixture => {
  writeFileSync(join(current.root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - contexts/*\n  - apps/*\n  - shared-packages/*/*\n  - infrastructure/*\n");
  for (const [path, name, manifest] of [
    ["apps/api", "@repo/app-api", {}],
    ["contexts/customers", "@repo/customers", {}],
    ["shared-packages/runtime/fastify", "@repo/runtime-fastify", { dependencies: { fastify: "catalog:" } }],
    ["shared-packages/sdk/inbound", "@repo/sdk-inbound", {}],
  ] as const) {
    mkdirSync(join(current.root, path), { recursive: true });
    writeFileSync(join(current.root, path, "package.json"), JSON.stringify({ name, exports: { ".": "./src/index.ts" }, ...manifest }));
  }
  writeFileSync(join(current.root, "package.json"), JSON.stringify({ name: "root" }));
  return current;
};

describe("lib role", () => {
  test("never depends on contexts, runtimes or apps", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "shared-packages/lib/target" }));
    fixture.writeManifest({ dependencies: { "@repo/customers": "workspace:^", "@repo/sdk-inbound": "workspace:^" }, devDependencies: { "@repo/runtime-fastify": "workspace:^" } });

    expect(fixture.run("lib packages never depend on contexts, runtimes or apps")).toEqual([
      "package.json dependencies declares @repo/customers: a lib package knows no context, runtime or app",
      "package.json devDependencies declares @repo/runtime-fastify: a lib package knows no context, runtime or app",
    ]);
  });
});

describe("runtime role", () => {
  test("depends at runtime only on the SDK packages and its platform libraries", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "shared-packages/runtime/target" }));
    fixture.writeManifest({ dependencies: { "@repo/sdk-inbound": "workspace:^", "@repo/customers": "workspace:^", hono: "catalog:" }, devDependencies: { "@repo/app-api": "workspace:^" } });

    expect(fixture.run("runtime packages depend at runtime only on the SDK packages")).toEqual([
      "package.json dependencies declares @repo/customers: a runtime package depends only on @repo/sdk-core, @repo/sdk-inbound, @repo/sdk-observability and its own platform libraries",
    ]);
  });

  test("is the only manifest that declares its platform library", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "shared-packages/runtime/target" }));
    fixture.writeManifest({ name: "@repo/runtime-target", dependencies: { fastify: "catalog:", hono: "catalog:" } });

    expect(fixture.run("runtime packages are the only manifests that declare their platform libraries")).toEqual(["@repo/runtime-fastify declares fastify: only @repo/runtime-target declares its platform library"]);
  });
});

describe("sdk role", () => {
  test("leaves OpenTelemetry to sdk-observability", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "shared-packages/sdk/target" });
    fixture.writeManifest({ dependencies: { "@opentelemetry/api": "catalog:" } });
    expect(fixture.run("only sdk-observability among the SDK packages depends on OpenTelemetry")).toEqual(["package.json dependencies declares @opentelemetry/api: only @repo/sdk-observability depends on OpenTelemetry"]);

    fixture.writeManifest({ name: "@repo/sdk-observability", dependencies: { "@opentelemetry/api": "catalog:" } });
    expect(fixture.run("only sdk-observability among the SDK packages depends on OpenTelemetry")).toEqual([]);
  });

  test("keeps sdk-inbound to its documented runtime dependencies", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "shared-packages/sdk/inbound" });
    fixture.writeManifest({ name: "@repo/sdk-inbound", dependencies: { "@repo/sdk-core": "workspace:^", zod: "catalog:" } });

    expect(fixture.run("has no runtime dependency beyond the documented ones")).toEqual(['package.json dependencies declares zod: inbound-processing.md: "`@repo/sdk-inbound` has zero runtime dependencies beyond `@repo/sdk-core`."']);
  });
});

describe("infrastructure role", () => {
  test("never depends on or imports apps, contexts, runtimes or delivery SDKs", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "infrastructure/target" }));
    fixture.writeManifest({ exports: {}, devDependencies: { "@repo/app-api": "workspace:^" } });
    fixture.write("src/index.ts", 'import { makePostgresCustomerRepository } from "@repo/customers";\nimport { ok } from "@repo/sdk-core";\n');

    expect(fixture.run("infrastructure packages never depend on or import apps, contexts, runtimes or delivery SDKs")).toEqual([
      "package.json devDependencies declares @repo/app-api: infrastructure never composes apps, contexts or runtimes",
      "src/index.ts imports @repo/customers: infrastructure never composes apps, contexts or runtimes",
    ]);
  });
});

describe("tsconfig presets", () => {
  test("exported presets define no path aliases and keep their entries inside the package", ({ fixture }) => {
    fixture.write("src/base.json", JSON.stringify({ compilerOptions: { paths: {} }, include: ["../../other/**"] }));
    fixture.writeManifest({ exports: { "./base": "./src/base.json" } });

    expect(fixture.run("exported tsconfig presets define no path aliases and keep include, exclude and files inside the package")).toEqual([
      "./src/base.json compilerOptions.paths is not allowed in a shared preset",
      "./src/base.json include ../../other/**: entry leaves the package",
    ]);
  });
});

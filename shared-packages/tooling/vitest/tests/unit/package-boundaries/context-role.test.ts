import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { type Fixture, test } from "../../support/checker-fixture.ts";

const telemetryCheck = "context packages never import OpenTelemetry or a logger, and never log";
const dependencyCheck = "context packages depend at runtime only on the SDK packages, shared lib packages and other contexts";
const providerCheck = "only outbound adapters import provider packages";
const servicesCheck = "services use only this context's own outbound ports, lib and entities, never an adapter";
const portsCheck = "outbound ports describe needs in entities only";
const adaptersCheck = "outbound adapters implement ports over entities and business rules";
const outboundLayoutCheck = "outbound folders hold one port module and one folder per adapter";
const adapterIsolationCheck = "outbound adapters never import another adapter";

// The fixture workspace plus another context, an app, a runtime and a shared lib next to the context under test.
const withNeighbours = (current: Fixture): Fixture => {
  writeFileSync(join(current.root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - contexts/*\n  - apps/*\n  - shared-packages/*/*\n");
  for (const [path, name] of [
    ["contexts/customers", "@repo/customers"],
    ["apps/api", "@repo/app-api"],
    ["shared-packages/runtime/fastify", "@repo/runtime-fastify"],
    ["shared-packages/lib/postgres", "@repo/lib-postgres"],
  ] as const) {
    mkdirSync(join(current.root, path), { recursive: true });
    writeFileSync(join(current.root, path, "package.json"), JSON.stringify({ name, exports: { ".": "./src/index.ts" } }));
  }
  return current;
};

describe("context role: telemetry", () => {
  test("fails a context that declares or imports OpenTelemetry or a logger, or logs through console", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.writeManifest({ dependencies: { "@opentelemetry/api": "catalog:", pino: "catalog:" } });
    fixture.write("src/services/invoice/index.ts", 'import { trace } from "@opentelemetry/api";\nimport { pino } from "pino";\nimport "@repo/sdk-observability";\nconsole.info("issued");\n');
    fixture.write("tests/invoice.test.ts", 'import winston from "winston";\n');

    expect(fixture.run(telemetryCheck)).toEqual([
      "package.json dependencies declares @opentelemetry/api: a context never depends on OpenTelemetry or a logger",
      "package.json dependencies declares pino: a context never depends on OpenTelemetry or a logger",
      "src/services/invoice/index.ts imports @opentelemetry/api: a context never imports OpenTelemetry or a logger; telemetry is a composition concern",
      "src/services/invoice/index.ts imports pino: a context never imports OpenTelemetry or a logger; telemetry is a composition concern",
      "src/services/invoice/index.ts imports @repo/sdk-observability: a context never imports OpenTelemetry or a logger; telemetry is a composition concern",
      "tests/invoice.test.ts imports winston: a context never imports OpenTelemetry or a logger; telemetry is a composition concern",
      "src/services/invoice/index.ts:4 logs through console: return failures through Result instead",
    ]);
  });

  test("passes a context that stays free of telemetry", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.write("src/index.ts", 'import { ok } from "@repo/sdk-core";\n// console.log in a comment is not logging.\nexport const issue = () => ok("issued");\n');

    expect(fixture.run(telemetryCheck)).toEqual([]);
  });

  test("applies only to context packages, contexts/<context>", ({ makeFixture }) => {
    const fixture = makeFixture();

    expect(() => fixture?.run(telemetryCheck)).toThrow(`no check named ${telemetryCheck}`);
  });
});

describe("context role: dependencies", () => {
  test("depends at runtime only on the SDK packages, shared lib packages and other contexts", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "contexts/invoicing" }));
    fixture.writeManifest({
      dependencies: { "@repo/sdk-core": "workspace:^", "@repo/sdk-outbound": "workspace:^", "@repo/lib-postgres": "workspace:^", "@repo/customers": "workspace:^", "@repo/runtime-fastify": "workspace:^", "@repo/app-api": "workspace:^" },
      devDependencies: { "@repo/tooling-vitest": "workspace:^" },
    });

    expect(fixture.run(dependencyCheck)).toEqual([
      "package.json dependencies declares @repo/runtime-fastify: a context depends only on @repo/sdk-core, @repo/sdk-inbound, @repo/sdk-outbound, shared lib packages and approved contexts",
      "package.json dependencies declares @repo/app-api: a context depends only on @repo/sdk-core, @repo/sdk-inbound, @repo/sdk-outbound, shared lib packages and approved contexts",
    ]);
  });

  test("lets only outbound adapters import provider packages", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "contexts/invoicing" }));
    const provider = 'import { eq } from "drizzle-orm";\nimport { makePostgresClient } from "@repo/lib-postgres";\nimport { ok } from "@repo/sdk-core";\nimport type { Customer } from "@repo/customers";\n';
    for (const rel of [
      "src/outbound/invoice-repository/postgres/index.ts",
      "src/outbound/invoice-repository/postgres/schema.ts",
      "src/outbound/invoice-repository/postgres/migrations.ts",
      "src/migrations.ts",
      "src/services/invoice/index.ts",
      "src/lib/invoice/totals.ts",
      "src/outbound/invoice-repository/index.ts",
    ]) {
      fixture.write(rel, provider);
    }
    const message = "only an outbound adapter (src/outbound/<port>/<adapter>/) imports a provider package";

    expect(fixture.run(providerCheck)).toEqual([
      `src/lib/invoice/totals.ts imports drizzle-orm: ${message}`,
      `src/lib/invoice/totals.ts imports @repo/lib-postgres: ${message}`,
      `src/migrations.ts imports drizzle-orm: ${message}`,
      `src/migrations.ts imports @repo/lib-postgres: ${message}`,
      `src/outbound/invoice-repository/index.ts imports drizzle-orm: ${message}`,
      `src/outbound/invoice-repository/index.ts imports @repo/lib-postgres: ${message}`,
      `src/services/invoice/index.ts imports drizzle-orm: ${message}`,
      `src/services/invoice/index.ts imports @repo/lib-postgres: ${message}`,
    ]);
  });

  test("lets a port module re-export a port an SDK package declares, and nothing else does", ({ makeFixture }) => {
    const fixture = withNeighbours(makeFixture({ packagePath: "contexts/platform" }));
    const sdkPort = 'export type { IdempotencyStore } from "@repo/sdk-inbound";\n';
    fixture.write("src/outbound/idempotency-store/index.ts", sdkPort);
    fixture.write("src/services/idempotency/index.ts", sdkPort);

    expect(fixture.run(providerCheck)).toEqual(["src/services/idempotency/index.ts imports @repo/sdk-inbound: only an outbound adapter (src/outbound/<port>/<adapter>/) imports a provider package"]);
  });
});

describe("context role: outbound layout", () => {
  test("keeps one port module per port folder and everything else in an adapter folder", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    for (const rel of [
      "src/outbound/invoice-repository/index.ts",
      "src/outbound/invoice-repository/postgres/index.ts",
      "src/outbound/invoice-repository/postgres/mappers.ts",
      "src/outbound/invoice-repository/postgres/migrations/manifest.json",
      "src/outbound/invoice-repository/stub/index.ts",
      "src/outbound/invoice-repository/types.ts",
      "src/outbound/invoice-repository.postgres.ts",
      "src/outbound/index.ts",
      "src/outbound/schema.postgres.ts",
    ]) {
      fixture.write(rel, "export {};\n");
    }

    expect(fixture.run(outboundLayoutCheck).map((violation) => violation.split(": ")[0])).toEqual([
      "src/outbound/index.ts",
      "src/outbound/invoice-repository.postgres.ts",
      "src/outbound/invoice-repository/types.ts",
      "src/outbound/schema.postgres.ts",
    ]);
  });

  test("keeps each adapter to its own folder, a stub included", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.write(
      "src/outbound/invoice-repository/postgres/index.ts",
      'import type { InvoiceRepository } from "#outbound/invoice-repository/index";\nimport { toInvoice } from "#outbound/invoice-repository/postgres/mappers";\nimport { makeInvoiceRepositoryStub } from "#outbound/invoice-repository/stub/index";\nimport { remindersTable } from "../../payment-reminder-repository/postgres/schema";\n',
    );

    expect(fixture.run(adapterIsolationCheck).map((violation) => violation.split(": ")[0])).toEqual([
      "src/outbound/invoice-repository/postgres/index.ts imports #outbound/invoice-repository/stub/index",
      "src/outbound/invoice-repository/postgres/index.ts imports ../../payment-reminder-repository/postgres/schema",
    ]);
  });
});

describe("context role: layers", () => {
  test("services reach ports, never an adapter", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.write(
      "src/services/invoice/index.ts",
      'import type { InvoiceRepository } from "#outbound/invoice-repository/index";\nimport { makeInvoiceRepositoryStub } from "#outbound/invoice-repository/stub/index";\nimport { invoicesTable } from "#outbound/invoice-repository/postgres/schema";\n',
    );

    expect(fixture.run(servicesCheck).map((violation) => violation.split(": ")[0])).toEqual([
      "src/services/invoice/index.ts imports #outbound/invoice-repository/stub/index",
      "src/services/invoice/index.ts imports #outbound/invoice-repository/postgres/schema",
    ]);
  });

  test("ports speak in entities and other ports, never in adapters or business rules", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.write(
      "src/outbound/invoice-repository/index.ts",
      'import type { Invoice } from "#entities/invoice/index";\nimport type { BillableCustomers } from "#outbound/billable-customers/index";\nimport { isOverdue } from "#lib/invoice/overdue";\nimport { invoicesTable } from "#outbound/invoice-repository/postgres/schema";\n',
    );

    expect(fixture.run(portsCheck).map((violation) => violation.split(": ")[0])).toEqual([
      "src/outbound/invoice-repository/index.ts imports #lib/invoice/overdue",
      "src/outbound/invoice-repository/index.ts imports #outbound/invoice-repository/postgres/schema",
    ]);
  });

  test("adapters implement ports over entities and business rules, never over services", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/invoicing" });
    fixture.write(
      "src/outbound/invoice-repository/stub/index.ts",
      'import { isOverdue } from "#lib/invoice/overdue";\nimport type { InvoiceRepository } from "#outbound/invoice-repository/index";\nimport { makeInvoiceService } from "#services/invoice/index";\n',
    );

    expect(fixture.run(adaptersCheck).map((violation) => violation.split(": ")[0])).toEqual(["src/outbound/invoice-repository/stub/index.ts imports #services/invoice/index"]);
  });
});

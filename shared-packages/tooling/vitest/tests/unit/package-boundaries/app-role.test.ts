import { describe, expect } from "vitest";

import { type Fixture, type MakeFixture, test } from "../../support/checker-fixture.ts";

const compositionRule = "only entrypoints and composition import composition";
const nativeRule = "only runtime-specific inbound code reads the native request";
const contractsImports = "imports other apps only through their contracts subpath";
const serverOnly = 'every module that imports composition, services, adapters or server actions starts with import "server-only"';

const firstPart = (violation: string): string => violation.split(": ")[0] ?? violation;
const appFixture = (makeFixture: MakeFixture, dependencies: Record<string, string> = {}): Fixture => {
  const fixture = makeFixture({ packagePath: "apps/target" });
  fixture.writeManifest({ name: "@repo/app-target", exports: { "./contracts": "./src/contracts/index.ts" }, dependencies });
  return fixture;
};

describe("app role: composition import rule", () => {
  test("fails when an inbound or outbound module imports composition", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    fixture.write("src/inbound/http/handler.ts", 'import { makeTestApi } from "#composition/test";\n');
    fixture.write("src/outbound/client.ts", 'import { makeProdApi } from "../composition/prod";\n');

    expect(fixture.run(compositionRule).map(firstPart).sort()).toEqual(["src/inbound/http/handler.ts imports #composition/test", "src/outbound/client.ts imports ../composition/prod"]);
  });

  test("lets entrypoints, composition, the instrumentation bootstrap and the healthcheck probe import composition", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    for (const rel of ["src/entrypoints/server.ts", "src/composition/prod.ts", "src/instrumentation.ts", "src/healthcheck.ts"]) {
      fixture.write(rel, 'import { readConfig } from "#composition/config";\n');
    }

    expect(fixture.run(compositionRule)).toEqual([]);
  });

  test("treats routes and the proxy of a Next.js app as entrypoints, and nothing else", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture, { next: "catalog:" });
    fixture.write("src/app/page.tsx", 'import { getProdWebComposition } from "#composition/prod";\n');
    fixture.write("src/proxy.ts", 'import { getProdWebComposition } from "#composition/prod";\n');
    fixture.write("src/components/widget.tsx", 'import { appIdentity } from "../composition/app-identity";\n');

    expect(fixture.run(compositionRule).map(firstPart)).toEqual(["src/components/widget.tsx imports ../composition/app-identity"]);
  });

  test("keeps routes of an app that is not a Next.js app to the rule", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    fixture.write("src/app/page.tsx", 'import { getProdWebComposition } from "#composition/prod";\n');

    expect(fixture.run(compositionRule).map(firstPart)).toEqual(["src/app/page.tsx imports #composition/prod"]);
  });
});

describe("app role: native request rule", () => {
  test("fails when a runtime-agnostic handler or composition reads the native request", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    fixture.write("src/inbound/api/invoices.ts", "export const issue = (input, ctx) => ctx.native.headers;\n");
    fixture.write("src/composition/local.ts", "export const peek = ({ native }) => native;\n");

    expect(fixture.run(nativeRule).map(firstPart).sort()).toEqual(["src/composition/local.ts:1 uses native", "src/composition/local.ts:1 uses native", "src/inbound/api/invoices.ts:1 uses native"]);
  });

  test("lets runtime-specific inbound code read the native request", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    fixture.write("src/inbound/node-http/client-address.ts", "export const clientAddress = (input, ctx) => ctx.native.socket.remoteAddress;\n");

    expect(fixture.run(nativeRule)).toEqual([]);
  });
});

describe("app role: other apps", () => {
  test("fails an import of another app outside its contracts subpath", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);
    fixture.write("src/outbound/client.ts", 'import { a } from "@repo/app-api/contracts";\nimport { b } from "@repo/app-api";\nimport { c } from "@repo/app-target/contracts";\n');

    expect(fixture.run(contractsImports)).toEqual(["src/outbound/client.ts imports @repo/app-api: import another app only from @repo/app-api/contracts"]);
  });
});

describe("Next.js app role: server-only modules", () => {
  test("fails a module that imports a server-side module without starting with server-only", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture, { next: "catalog:" });
    fixture.write("src/app/customers/actions.ts", '"use server";\nimport "server-only";\nimport { compose } from "#composition/prod";\n');
    fixture.write("src/app/customers/page.tsx", 'import { register } from "./actions";\n');
    fixture.write("src/app/invoices/page.tsx", 'import { observe } from "@repo/sdk-inbound";\n');
    fixture.write("src/app/invoices/types.ts", 'import type { Principal } from "@repo/sdk-inbound";\n');
    fixture.write("src/app/home.tsx", 'import { appIdentity } from "#composition/app-identity";\n');

    expect(fixture.run(serverOnly)).toEqual(['src/app/customers/page.tsx imports a server-side module: start it with import "server-only"', 'src/app/invoices/page.tsx imports a server-side module: start it with import "server-only"']);
  });

  test("exempts the modules entrypoints reach, which run under plain Node, and the Next server hooks", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture, { next: "catalog:" });
    fixture.write("src/entrypoints/migrate.ts", 'import { migrate } from "#composition/migrate";\n');
    fixture.write("src/composition/migrate.ts", 'import { database } from "./database";\n');
    fixture.write("src/composition/database.ts", 'import { connect } from "#composition/local-database";\n');
    fixture.write("src/instrumentation.ts", 'import { telemetry } from "#composition/telemetry";\n');
    fixture.write("src/composition/prod.ts", 'import { database } from "#composition/database";\n');

    expect(fixture.run(serverOnly)).toEqual(['src/composition/prod.ts imports a server-side module: start it with import "server-only"']);
  });

  test("applies only to Next.js apps", ({ makeFixture }) => {
    const fixture = appFixture(makeFixture);

    expect(() => fixture.run(serverOnly)).toThrow(`no check named ${serverOnly}`);
  });
});

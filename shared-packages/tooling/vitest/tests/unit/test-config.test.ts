import { describe, expect, test } from "vitest";

import { defineTestConfig } from "#index";

type Project = { readonly extends: boolean; readonly test: { readonly name: string; readonly include: string[]; readonly globalSetup?: string[] } };
const projectsOf = (config: ReturnType<typeof defineTestConfig>) => (config.test?.projects ?? []) as Project[];

describe("defineTestConfig", () => {
  test("splits a package's tests into a unit project, which also runs the package-boundaries test, and an integration project by folder", () => {
    expect(projectsOf(defineTestConfig()).map(({ test: { name, include } }) => [name, include])).toEqual([
      ["unit", ["tests/package-boundaries.test.ts", "tests/unit/**/*.test.{ts,tsx}"]],
      ["integration", ["tests/integration/**/*.test.{ts,tsx}"]],
    ]);
  });

  test("starts providers for the integration project only", () => {
    const [unit, integration] = projectsOf(defineTestConfig({ integrationGlobalSetup: ["@repo/lib-postgres/testing/global-setup"] }));

    expect([unit?.test.globalSetup, integration?.test.globalSetup]).toEqual([undefined, ["@repo/lib-postgres/testing/global-setup"]]);
  });

  test("lets both projects inherit the shared config", () => {
    const config = defineTestConfig({ shared: { resolve: { alias: { "server-only": "/stub.ts" } } } });

    expect([config.resolve?.alias, projectsOf(config).map((project) => project.extends)]).toEqual([{ "server-only": "/stub.ts" }, [true, true]]);
  });
});

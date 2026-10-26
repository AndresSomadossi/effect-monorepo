import { mergeConfig, type ViteUserConfig } from "vitest/config";

/** Unit tests: no container engine, no network beyond loopback, no database. `test:unit` runs them. */
export const unitTestFiles = "tests/unit/**/*.test.{ts,tsx}";

/** The package-boundaries test, the one test file at the root of tests/. The unit project runs it. */
export const packageBoundariesTestFile = "tests/package-boundaries.test.ts";

/** Integration tests: real providers started by the integration project's globalSetup. `test:integration` runs them. */
export const integrationTestFiles = "tests/integration/**/*.test.{ts,tsx}";

export type TestConfigOptions = {
  /**
   * Modules the integration project runs once per `test:integration` run before any test file, resolved from the package root,
   * such as `@repo/lib-postgres/testing/global-setup`. They start the providers the integration fixtures inject.
   */
  readonly integrationGlobalSetup?: readonly string[];
  /** Config both projects share, such as a `resolve.alias`. */
  readonly shared?: ViteUserConfig;
};

/**
 * The one Vitest config every workspace package uses (docs/architecture/reference/testing.md): a `unit` project over `tests/unit/`
 * and the package-boundaries test, and an `integration` project over `tests/integration/`. `test:unit` runs `vitest run --project unit`, `test:integration`
 * runs `vitest run --project integration`, so a unit run never starts a provider.
 */
export const defineTestConfig = ({ integrationGlobalSetup = [], shared = {} }: TestConfigOptions = {}): ViteUserConfig =>
  mergeConfig(shared, {
    test: {
      projects: [
        { extends: true, test: { name: "unit", include: [packageBoundariesTestFile, unitTestFiles] } },
        {
          extends: true,
          // Providers start once in globalSetup; a file's own setup only creates its isolated resources, such as one database.
          test: { name: "integration", include: [integrationTestFiles], globalSetup: [...integrationGlobalSetup], testTimeout: 30_000, hookTimeout: 60_000 },
        },
      ],
    },
  } satisfies ViteUserConfig);

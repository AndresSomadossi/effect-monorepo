import type { CodeRule, LayerRule } from "#package-boundaries/layers";
import { appRole, contextRole, libRole } from "#package-boundaries/roles";
import type { PackageJson } from "#workspace/package-manifest";

// The intra-package rules of each role, derived from docs/architecture/reference. A package gets the rules of its role; it never lists them.

/** inbound-runtimes.md current and reserved runtimes; each may get a runtime-specific folder under src/inbound/<runtime>/. */
const runtimeNames: readonly string[] = ["node-http", "fastify", "local", "lambda", "next"];
const runtimePackages = runtimeNames.map((name) => `@repo/runtime-${name}`);
const runtimeInboundFolders = runtimeNames.map((name) => `src/inbound/${name}/**`);

/** frontend-nextjs.md: a Next.js app is an app that depends on `next`. Next owns its entrypoint, so routes stand in for src/entrypoints/. */
export const isNextApp = (packageJson: PackageJson): boolean => Object.hasOwn(packageJson.dependencies ?? {}, "next");

const contractsRules: readonly LayerRule[] = [
  {
    name: "contracts stay free of app internals",
    source: 'app-contracts.md: "Do not expose handlers, composition modules, or app internals through the contracts subpath." and "Do not put runtime handlers under `contracts/`."',
    from: ["src/contracts/**"],
    mayImportOnly: ["src/contracts/**"],
  },
  {
    name: "contracts do not import delivery frameworks",
    source: 'app-contracts.md: "Inbound adapters own delivery serialization for API and event handlers." and "Do not put runtime handlers under `contracts/`."',
    from: ["src/contracts/**"],
    mayNotImport: ["package:fastify", "package:next", "package:react", "package:react-dom", ...runtimePackages.map((name) => `package:${name}`)],
  },
];

/** The composition import rule of an app; a Next.js app's routes, proxy and instrumentation hook are its entrypoints. */
export const compositionImportRule = (nextApp: boolean): LayerRule => ({
  name: "only entrypoints and composition import composition",
  source:
    'app-composition.md: "Only entrypoints and composition import composition." and "Entrypoints under `src/entrypoints/` pair one composition variant with one inbound runtime"; observability.md: "Node apps load `@opentelemetry/sdk-node` before the app starts, through `node --import`."; frontend-nextjs.md: "Routes, layouts, and route-private files live under `src/app/`."',
  from: ["src/**"],
  // src/instrumentation.ts is the `--import` bootstrap in front of the entrypoints (the instrumentation hook in Next); it reads App Identity
  // and telemetry config from composition. src/healthcheck.ts is the container HEALTHCHECK probe, bundled as its own file; it reads the port.
  except: ["src/entrypoints/**", "src/composition/**", "src/instrumentation.ts", "src/healthcheck.ts", ...(nextApp ? ["src/app/**", "src/proxy.ts"] : [])],
  mayNotImport: ["src/composition/**"],
});

const runtimeImportRule: LayerRule = {
  name: "only entrypoints and runtime-specific inbound code import runtime packages",
  source: 'inbound-runtimes.md: "Only app composition and entrypoints consume runtime packages." and inbound-processing.md: "Only code under `apps/*/src/inbound/<runtime>/` may read `ctx.native`."',
  from: ["src/**"],
  except: ["src/entrypoints/**", "src/composition/**", ...runtimeInboundFolders],
  mayNotImport: runtimePackages.map((name) => `package:${name}`),
};

/** Static approximation: any `native` token (property read, destructuring or string key) outside the runtime-specific folders. */
export const nativeAccessRule: CodeRule = {
  name: "only runtime-specific inbound code reads the native request",
  source: 'inbound-processing.md: "Only code under `apps/*/src/inbound/<runtime>/` may read `ctx.native`. Everything else stays runtime-agnostic."',
  from: ["src/**"],
  except: runtimeInboundFolders,
  mayNotMatch: /\bnative\b/,
};

const appLayers = (nextApp: boolean): readonly LayerRule[] => [
  ...contractsRules,
  compositionImportRule(nextApp),
  runtimeImportRule,
  {
    name: "inbound adapters and routes do not construct outbound adapters",
    source: 'app-composition.md: "Do not scatter adapter and service factory calls throughout handlers."',
    from: ["src/inbound/**", ...(nextApp ? ["src/app/**"] : [])],
    mayNotImport: ["src/outbound/**"],
  },
  {
    name: "outbound adapters do not reach delivery or composition",
    source: 'glossary.md Adapter Config: "Apps provide adapter config during composition." and outbound-adapters.md: "Apps pass all required config into adapter factories."',
    from: ["src/outbound/**"],
    mayNotImport: ["src/inbound/**", "src/app/**", "src/components/**", "src/composition/**"],
  },
  ...(nextApp
    ? [
        {
          name: "client components never receive identity or outbound clients",
          source: 'app-composition.md: "make identity-carrying calls server-side only" and "Frontends pass at most `version` to client code, never the manifest."',
          from: ["src/**"],
          fromDirective: "use client" as const,
          mayNotImport: ["src/composition/**", "src/outbound/**", "package.json"],
        },
      ]
    : []),
];

/**
 * outbound-ports.md: a port is the one module of its folder, `src/outbound/<port>/index.ts`, named after the port. outbound-adapters.md: everything an
 * adapter owns, its mappers, row types, schema and migrations included, lives in its own folder under the port it implements,
 * `src/outbound/<port>/<adapter>/`, such as `postgres/` or `stub/`. A stub is an adapter like any other.
 */
export const outboundPortPattern = "src/outbound/*";
// The first pattern is an adapter folder's index.ts, which layer patterns see as the folder itself.
export const outboundAdapterPatterns: readonly string[] = ["src/outbound/*/*", "src/outbound/*/*/**"];

/**
 * Intra-context layer rules (bounded-contexts.md): entities depend on nothing, lib computes over entities, ports speak in entities,
 * adapters implement ports, services orchestrate over ports and never reach an adapter.
 */
const contextLayers: readonly LayerRule[] = [
  {
    name: "entities depend on no other layer",
    source: 'domain-modeling.md: "Entities are the context\'s data shapes, in `src/entities/<subject>/index.ts`: TypeScript types only." and bounded-contexts.md: "`entities/` imports only `entities/`."',
    from: ["src/entities/**"],
    mayImportOnly: ["src/entities/**"],
  },
  {
    name: "business rules in lib take no dependencies: they import only entities and lib",
    source: 'domain-modeling.md: "Business rules take no dependencies: no outbound port, clock, random source or dependency bag." and bounded-contexts.md: "`lib/` imports only `entities/` and `lib/`."',
    from: ["src/lib/**"],
    mayImportOnly: ["src/entities/**", "src/lib/**"],
  },
  {
    name: "outbound ports describe needs in entities only",
    source: 'outbound-ports.md: "Outbound ports describe the bounded context need in context language; provider schemas live in the adapters below them." and bounded-contexts.md: "ports in `outbound/` import only `entities/` and other ports."',
    from: ["src/outbound/**"],
    except: outboundAdapterPatterns,
    mayImportOnly: ["src/entities/**", outboundPortPattern],
  },
  {
    name: "outbound adapters implement ports over entities and business rules",
    source:
      'outbound-adapters.md: "A stub that must apply a business rule, such as a list filter, imports the rule from `lib/` instead of restating it." and bounded-contexts.md: "adapters import `entities/`, `lib/`, the ports in `outbound/` and their own folder."',
    from: outboundAdapterPatterns,
    mayImportOnly: ["src/entities/**", "src/lib/**", outboundPortPattern, ...outboundAdapterPatterns],
  },
  {
    name: "services use only this context's own outbound ports, lib and entities, never an adapter",
    source:
      'outbound-ports.md: "Services may use only outbound ports declared by their own bounded context." and bounded-contexts.md: "`services/` imports `services/`, `entities/`, `lib/` and the ports in `outbound/`, never an adapter: app composition picks the adapter."',
    from: ["src/services/**"],
    mayImportOnly: ["src/services/**", "src/entities/**", "src/lib/**", outboundPortPattern],
    mayNotImport: outboundAdapterPatterns,
  },
];

const contextCodeRules: readonly CodeRule[] = [
  {
    name: "entities export types only",
    source: 'domain-modeling.md: "Do not put functions or constants in `entities/`."',
    from: ["src/entities/**"],
    mayNotMatch: /^\s*export\s+(?:const|let|var|function|class|enum)\b/m,
  },
];

export type RoleRules = {
  internalLayers: readonly LayerRule[];
  codeRules: readonly CodeRule[];
  /** src/ files allowed to read process.env; `undefined` leaves process.env unchecked. */
  processEnvAllowedIn: readonly string[] | undefined;
};

/** The layer, code and process.env rules of a role. */
export function roleRulesOf(role: string | undefined, packageJson: PackageJson): RoleRules {
  if (role === appRole) {
    // app-composition.md: "Runtime config reads from `process.env` inside app composition config code."
    return { internalLayers: appLayers(isNextApp(packageJson)), codeRules: [nativeAccessRule], processEnvAllowedIn: ["src/composition/config.ts"] };
  }
  if (role === contextRole) {
    // app-composition.md: "Do not read environment variables in context packages." outbound-adapters.md: "Apps pass all required config into adapter factories."
    return { internalLayers: contextLayers, codeRules: contextCodeRules, processEnvAllowedIn: [] };
  }
  // package-public-surfaces.md: a lib package holds no runtime config; the adapters it serves receive theirs from app composition.
  return { internalLayers: [], codeRules: [], processEnvAllowedIn: role === libRole ? [] : undefined };
}

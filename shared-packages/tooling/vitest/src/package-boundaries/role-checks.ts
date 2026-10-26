import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { matchesLayerPattern, normalizeModulePath, resolveInternalTarget } from "#package-boundaries/layers";
import { isNextApp, outboundAdapterPatterns, outboundPortPattern } from "#package-boundaries/role-rules";
import { appRole, contextRole, infrastructureRole, libRole, runtimeRole, sdkRole } from "#package-boundaries/roles";
import { classify, packageNameOf, stripComments } from "#package-boundaries/source-scan";
import { tsconfigFenceViolations } from "#package-boundaries/tsconfig-fence";
import { type DependencyField, dependencyFields, type PackageJson } from "#workspace/package-manifest";

// Checks every package of a role gets, beyond its layer rules (role-rules.ts). Each one cites the doc rule it enforces.

export type RoleCheck = { name: string; run: () => string[] };

export type RoleCheckContext = {
  packageDirectory: string;
  packageJson: PackageJson;
  collectImports: () => readonly { file: string; rel: string; spec: string }[];
  scannedFiles: () => readonly { file: string; rel: string }[];
  readText: (file: string) => string;
  /** The workspace role of a workspace package by name, or `undefined` when the name is not a workspace package. */
  roleOfWorkspacePackage: (name: string) => string | undefined;
  /** The repository root manifest and every workspace manifest. */
  repositoryManifests: () => readonly PackageJson[];
};

const runtimeDependencyFields: readonly DependencyField[] = ["dependencies", "peerDependencies", "optionalDependencies"];

const declaredIn = (packageJson: PackageJson, fields: readonly DependencyField[]): { field: DependencyField; name: string }[] => fields.flatMap((field) => Object.keys(packageJson[field] ?? {}).map((name) => ({ field, name })));

// observability.md: "A context never imports OpenTelemetry and never logs." bounded-contexts.md: "A context never imports OpenTelemetry, a logger, ..."
const telemetryPackagePatterns: readonly RegExp[] = [/^@opentelemetry\//, /^@vercel\/otel$/, /^@repo\/sdk-observability$/, /^pino(?:-.+)?$/, /^@pinojs\//, /^(?:winston|bunyan|log4js|loglevel|consola|signale|roarr|tslog|debug)$/];

export const isTelemetryPackage = (name: string): boolean => telemetryPackagePatterns.some((pattern) => pattern.test(name));

const consolePattern = /\bconsole\s*\./g;

export const contextTelemetryCheckName = "context packages never import OpenTelemetry or a logger, and never log";

/** Telemetry or logger dependencies and imports anywhere in the package, and console calls in src/. */
function contextTelemetryViolations({ packageJson, collectImports, scannedFiles, readText }: RoleCheckContext): string[] {
  const declared = declaredIn(packageJson, dependencyFields)
    .filter(({ name }) => isTelemetryPackage(name))
    .map(({ field, name }) => `package.json ${field} declares ${name}: a context never depends on OpenTelemetry or a logger`);
  const imported = collectImports()
    .filter(({ spec }) => isTelemetryPackage(packageNameOf(spec)))
    .map(({ rel, spec }) => `${rel} imports ${spec}: a context never imports OpenTelemetry or a logger; telemetry is a composition concern`);
  const logged = scannedFiles()
    .filter(({ rel }) => rel.startsWith("src/"))
    .flatMap(({ file, rel }) => {
      const code = stripComments(readText(file));
      return [...code.matchAll(consolePattern)].map((match) => `${rel}:${code.slice(0, match.index).split("\n").length} logs through console: return failures through Result instead`);
    });
  return [...declared, ...imported, ...logged];
}

export const contextDependencyCheckName = "context packages depend at runtime only on the SDK packages, shared lib packages and other contexts";

// bounded-contexts.md: "A context depends on `@repo/sdk-core`, the SDK packages that declare the ports or plumbing its adapters use
// (`@repo/sdk-inbound`, `@repo/sdk-outbound`), shared lib packages and explicitly approved other contexts only."
const contextWorkspaceDependencies: readonly string[] = ["@repo/sdk-core", "@repo/sdk-inbound", "@repo/sdk-outbound"];
const contextWorkspaceRoles: readonly string[] = [libRole, contextRole];

function contextDependencyViolations({ packageJson, roleOfWorkspacePackage }: RoleCheckContext): string[] {
  return declaredIn(packageJson, runtimeDependencyFields)
    .filter(({ name }) => name.startsWith("@repo/") && !contextWorkspaceDependencies.includes(name) && !contextWorkspaceRoles.includes(roleOfWorkspacePackage(name) ?? ""))
    .map(({ field, name }) => `package.json ${field} declares ${name}: a context depends only on ${contextWorkspaceDependencies.join(", ")}, shared lib packages and approved contexts`);
}

export const contextProviderImportCheckName = "only outbound adapters import provider packages";

// bounded-contexts.md: "Entities, business rules, ports and services import no package but `@repo/sdk-core` and approved contexts: provider
// libraries and their plumbing are reachable only from the adapter folders in `src/outbound/`." outbound-ports.md: a port that an SDK
// package declares, such as `IdempotencyStore`, is re-exported from its port module.
const portSdkPackages: readonly string[] = ["@repo/sdk-inbound"];

function contextProviderImportViolations({ collectImports, roleOfWorkspacePackage }: RoleCheckContext): string[] {
  const allowed = (rel: string, spec: string) =>
    packageNameOf(spec) === "@repo/sdk-core" || roleOfWorkspacePackage(packageNameOf(spec)) === contextRole || (matchesLayerPattern(rel, outboundPortPattern) && portSdkPackages.includes(packageNameOf(spec)));
  return collectImports()
    .filter(({ rel }) => rel.startsWith("src/") && !outboundAdapterPatterns.some((pattern) => matchesLayerPattern(rel, pattern)))
    .filter(({ rel, spec }) => (classify(spec) === "external" || classify(spec) === "workspace") && !allowed(rel, spec))
    .map(({ rel, spec }) => `${rel} imports ${spec}: only an outbound adapter (src/outbound/<port>/<adapter>/) imports a provider package`);
}

export const contextOutboundLayoutCheckName = "outbound folders hold one port module and one folder per adapter";

const outboundAdapterFolderOf = (rel: string): string | undefined => /^(src\/outbound\/[^/]+\/[^/]+)\//.exec(rel)?.[1];

// outbound-ports.md: "`src/outbound/<port>/index.ts` is the port and the only module of its folder." outbound-adapters.md:
// "Everything an adapter owns lives in its folder, `src/outbound/<port>/<adapter>/`."
function contextOutboundLayoutViolations({ packageDirectory }: RoleCheckContext): string[] {
  const outbound = join(packageDirectory, "src", "outbound");
  if (!existsSync(outbound)) {
    return [];
  }
  return readdirSync(outbound, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => relative(packageDirectory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((rel) => !/^src\/outbound\/[^/]+\/index\.[cm]?[jt]sx?$/.test(rel) && outboundAdapterFolderOf(rel) === undefined)
    .sort()
    .map((rel) => `${rel}: an outbound folder holds only its port, src/outbound/<port>/index.ts, and its adapters' folders, src/outbound/<port>/<adapter>/`);
}

export const contextAdapterIsolationCheckName = "outbound adapters never import another adapter";

// outbound-adapters.md: "An adapter imports nothing from another adapter's folder, a stub included: each one stands alone behind its port."
function contextAdapterIsolationViolations({ packageDirectory, packageJson, collectImports }: RoleCheckContext): string[] {
  return collectImports()
    .filter(({ rel }) => outboundAdapterFolderOf(rel) !== undefined)
    .flatMap(({ file, rel, spec }) => {
      const target = resolveInternalTarget({ file, spec, packageDirectory, importsField: packageJson.imports });
      const targetFolder = target === undefined ? undefined : outboundAdapterFolderOf(`${target}/`);
      return targetFolder !== undefined && targetFolder !== outboundAdapterFolderOf(rel) ? [`${rel} imports ${spec}: an adapter imports only its own folder, never ${targetFolder}/`] : [];
    });
}

/** Violations of a rule that forbids depending on workspace packages of some roles, or on some workspace packages by name, in any field. */
function forbiddenDependencyViolations(context: RoleCheckContext, { roles, names = [], reason }: { roles: readonly string[]; names?: readonly string[]; reason: string }): string[] {
  const forbidden = (name: string) => name !== context.packageJson.name && (names.includes(name) || roles.includes(context.roleOfWorkspacePackage(name) ?? ""));
  return declaredIn(context.packageJson, dependencyFields)
    .filter(({ name }) => forbidden(name))
    .map(({ field, name }) => `package.json ${field} declares ${name}: ${reason}`);
}

export const libDependencyCheckName = "lib packages never depend on contexts, runtimes or apps";

export const runtimeDependencyCheckName = "runtime packages depend at runtime only on the SDK packages";

// inbound-runtimes.md: "A runtime package may depend only on `@repo/sdk-core`, `@repo/sdk-inbound`, `@repo/sdk-observability` and its own platform libraries."
const runtimeWorkspaceDependencies: readonly string[] = ["@repo/sdk-core", "@repo/sdk-inbound", "@repo/sdk-observability"];

function runtimeDependencyViolations({ packageJson }: RoleCheckContext): string[] {
  return declaredIn(packageJson, runtimeDependencyFields)
    .filter(({ name }) => name.startsWith("@repo/") && !runtimeWorkspaceDependencies.includes(name))
    .map(({ field, name }) => `package.json ${field} declares ${name}: a runtime package depends only on ${runtimeWorkspaceDependencies.join(", ")} and its own platform libraries`);
}

export const runtimePlatformCheckName = "runtime packages are the only manifests that declare their platform libraries";

// inbound-runtimes.md: a runtime's platform library is reachable only through its runtime package, such as Fastify through @repo/runtime-fastify.
function runtimePlatformViolations({ packageJson, repositoryManifests }: RoleCheckContext): string[] {
  const platformLibraries = declaredIn(packageJson, runtimeDependencyFields)
    .map(({ name }) => name)
    .filter((name) => !name.startsWith("@repo/"));
  return repositoryManifests()
    .filter((manifest) => manifest.name !== packageJson.name)
    .flatMap((manifest) =>
      platformLibraries.filter((library) => dependencyFields.some((field) => Object.hasOwn(manifest[field] ?? {}, library))).map((library) => `${manifest.name} declares ${library}: only ${packageJson.name} declares its platform library`),
    );
}

export const sdkTelemetryCheckName = "only sdk-observability among the SDK packages depends on OpenTelemetry";

// sdk-packages.md: "`@repo/sdk-observability` ... is the only SDK package that depends on OpenTelemetry."
function sdkTelemetryViolations({ packageJson }: RoleCheckContext): string[] {
  if (packageJson.name === "@repo/sdk-observability") {
    return [];
  }
  return declaredIn(packageJson, dependencyFields)
    .filter(({ name }) => name.startsWith("@opentelemetry/"))
    .map(({ field, name }) => `package.json ${field} declares ${name}: only @repo/sdk-observability depends on OpenTelemetry`);
}

/** Packages whose runtime dependencies a doc pins exactly, external packages included. */
const documentedRuntimeDependencies: Readonly<Record<string, { dependencies: readonly string[]; source: string }>> = {
  "@repo/sdk-inbound": { dependencies: ["@repo/sdk-core"], source: 'inbound-processing.md: "`@repo/sdk-inbound` has zero runtime dependencies beyond `@repo/sdk-core`."' },
};

export const documentedRuntimeDependencyCheckName = "has no runtime dependency beyond the documented ones";

function documentedRuntimeDependencyViolations({ packageJson }: RoleCheckContext): string[] {
  const documented = documentedRuntimeDependencies[packageJson.name];
  if (documented === undefined) {
    return [];
  }
  return declaredIn(packageJson, runtimeDependencyFields)
    .filter(({ name }) => !documented.dependencies.includes(name))
    .map(({ field, name }) => `package.json ${field} declares ${name}: ${documented.source}`);
}

export const infrastructureDependencyCheckName = "infrastructure packages never depend on or import apps, contexts, runtimes or delivery SDKs";

// infrastructure.md: "Infrastructure packages do not compose business services", "Do not put app composition in infrastructure packages." and
// "Do not import context service factories or adapters into infrastructure packages." Runtimes and SDK delivery code are app concerns too.
const infrastructureForbiddenRoles: readonly string[] = [appRole, contextRole, runtimeRole];
const infrastructureForbiddenNames: readonly string[] = ["@repo/sdk-inbound", "@repo/sdk-outbound"];
const infrastructureReason = "infrastructure never composes apps, contexts or runtimes";

function infrastructureViolations(context: RoleCheckContext): string[] {
  const forbidden = (name: string) => infrastructureForbiddenNames.includes(name) || infrastructureForbiddenRoles.includes(context.roleOfWorkspacePackage(name) ?? "");
  const imported = context
    .collectImports()
    .filter(({ spec }) => classify(spec) === "workspace" && forbidden(packageNameOf(spec)))
    .map(({ rel, spec }) => `${rel} imports ${spec}: ${infrastructureReason}`);
  return [...forbiddenDependencyViolations(context, { roles: infrastructureForbiddenRoles, names: infrastructureForbiddenNames, reason: infrastructureReason }), ...imported];
}

export const appContractsImportCheckName = "imports other apps only through their contracts subpath";

// app-contracts.md: another app is reachable only through its `./contracts` subpath.
function appContractsImportViolations({ packageJson, collectImports }: RoleCheckContext): string[] {
  return collectImports()
    .filter(({ spec }) => classify(spec) === "workspace" && packageNameOf(spec).startsWith("@repo/app-") && packageNameOf(spec) !== packageJson.name)
    .filter(({ spec }) => spec !== `${packageNameOf(spec)}/contracts`)
    .map(({ rel, spec }) => `${rel} imports ${spec}: import another app only from ${packageNameOf(spec)}/contracts`);
}

// Built from strings because the scanner reads `import "x"` anywhere in code, string literals included.
const serverOnlyImport = ["import", '"server-only"'].join(" ");

export const serverOnlyCheckName = `every module that imports composition, services, adapters or server actions starts with ${serverOnlyImport}`;

// Context packages (`@repo/<context>`), which hold services and their adapters, and shared lib packages.
const serverSideRoles: readonly string[] = [contextRole, libRole];
const serverSidePackages: readonly string[] = ["@repo/sdk-observability", "@repo/sdk-inbound"];
/** Next runs these as the request proxy and the instrumentation hook, never in a client bundle. */
const nextServerHooks: readonly string[] = ["src/proxy.ts", "src/instrumentation.ts"];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A type-only import is erased from every bundle, so a client-safe module may take types from a service package.
const isTypeOnlyImport = (text: string, spec: string): boolean => {
  const statements = text.match(new RegExp(`import[^;]*?from\\s*["']${escapeRegExp(spec)}["']`, "g")) ?? [];
  return statements.length > 0 && statements.every((statement) => /^import\s+type\s/.test(statement));
};
const leadingStatements = (text: string): string => text.replace(/^(?:\s|\/\/[^\n]*\n|"use server";?)*/, "");

/**
 * frontend-nextjs.md: "Modules that import composition, services, or adapters start with `import "server-only"` so they can never enter a
 * client bundle." Entrypoints and every module they reach run under plain Node, where `server-only` throws, so they are exempt.
 */
function serverOnlyViolations({ packageDirectory, packageJson, collectImports, readText, roleOfWorkspacePackage }: RoleCheckContext): string[] {
  const imports = collectImports().filter(({ rel }) => rel.startsWith("src/"));
  const targetOf = (file: string, spec: string) => resolveInternalTarget({ file, spec, packageDirectory, importsField: packageJson.imports });
  const moduleOf = (rel: string) => normalizeModulePath(rel);
  // Modules reachable from src/entrypoints/** through relative and `#` imports.
  const plainNode = new Set(imports.filter(({ rel }) => rel.startsWith("src/entrypoints/")).map(({ rel }) => moduleOf(rel)));
  for (let size = -1; size !== plainNode.size; ) {
    size = plainNode.size;
    for (const { file, rel, spec } of imports) {
      const target = targetOf(file, spec);
      if (target !== undefined && plainNode.has(moduleOf(rel))) {
        plainNode.add(target);
      }
    }
  }
  const isServerSidePackage = (name: string) => serverSidePackages.includes(name) || serverSideRoles.includes(roleOfWorkspacePackage(name) ?? "");
  const importsServerSide = (spec: string): boolean =>
    /^#composition\/(?!config$|app-identity$)/.test(spec) || /^#inbound\//.test(spec) || (classify(spec) === "workspace" && isServerSidePackage(packageNameOf(spec))) || /^\.\.?\/(?:.*\/)?(?:actions|[a-z-]+-actions|[a-z-]+-pages)$/.test(spec);
  const offenders = new Set(
    imports
      .filter(({ rel }) => !plainNode.has(moduleOf(rel)) && !nextServerHooks.includes(rel))
      .filter(({ file, spec }) => importsServerSide(spec) && !isTypeOnlyImport(readText(file), spec))
      .filter(({ file }) => !leadingStatements(readText(file)).startsWith(`${serverOnlyImport};`))
      .map(({ rel }) => rel),
  );
  return [...offenders].map((rel) => `${rel} imports a server-side module: start it with ${serverOnlyImport}`);
}

export const presetCheckName = "exported tsconfig presets define no path aliases and keep include, exclude and files inside the package";

/** tsconfig keys that could alias another package's internals. */
export function forbiddenTsconfigKeys(config: unknown): string[] {
  if (typeof config !== "object" || config === null) {
    return [];
  }
  const record = config as Record<string, unknown>;
  const compilerOptions = typeof record.compilerOptions === "object" && record.compilerOptions !== null ? record.compilerOptions : {};
  return [...["paths", "baseUrl", "rootDirs"].filter((key) => key in compilerOptions).map((key) => `compilerOptions.${key}`), ...("references" in record ? ["references"] : [])];
}

/** Exported `.json` targets are tsconfig presets: their entries resolve from the preset's own directory, so they must stay inside this package. */
const exportedPresets = (packageJson: PackageJson): string[] =>
  typeof packageJson.exports === "object" && packageJson.exports !== null ? Object.values(packageJson.exports).filter((target): target is string => typeof target === "string" && target.endsWith(".json")) : [];

function presetViolations({ packageDirectory, packageJson }: RoleCheckContext): string[] {
  return exportedPresets(packageJson).flatMap((target) => {
    const path = join(packageDirectory, target);
    const config: unknown = JSON.parse(readFileSync(path, "utf8"));
    return [...forbiddenTsconfigKeys(config).map((key) => `${target} ${key} is not allowed in a shared preset`), ...tsconfigFenceViolations({ label: target, config, configDirectory: dirname(path), packageDirectory })];
  });
}

/** The checks of a role, plus the checks that follow from what a package declares. */
export function roleChecksOf(role: string | undefined, context: RoleCheckContext): RoleCheck[] {
  const byRole: Record<string, RoleCheck[]> = {
    [appRole]: [{ name: appContractsImportCheckName, run: () => appContractsImportViolations(context) }, ...(isNextApp(context.packageJson) ? [{ name: serverOnlyCheckName, run: () => serverOnlyViolations(context) }] : [])],
    [contextRole]: [
      { name: contextTelemetryCheckName, run: () => contextTelemetryViolations(context) },
      { name: contextDependencyCheckName, run: () => contextDependencyViolations(context) },
      { name: contextProviderImportCheckName, run: () => contextProviderImportViolations(context) },
      { name: contextOutboundLayoutCheckName, run: () => contextOutboundLayoutViolations(context) },
      { name: contextAdapterIsolationCheckName, run: () => contextAdapterIsolationViolations(context) },
    ],
    // package-public-surfaces.md: a lib package "never depends on `contexts/*`, `shared-packages/runtime/*` or `apps/*`."
    [libRole]: [{ name: libDependencyCheckName, run: () => forbiddenDependencyViolations(context, { roles: [contextRole, runtimeRole, appRole], reason: "a lib package knows no context, runtime or app" }) }],
    [runtimeRole]: [
      { name: runtimeDependencyCheckName, run: () => runtimeDependencyViolations(context) },
      { name: runtimePlatformCheckName, run: () => runtimePlatformViolations(context) },
    ],
    [sdkRole]: [{ name: sdkTelemetryCheckName, run: () => sdkTelemetryViolations(context) }],
    [infrastructureRole]: [{ name: infrastructureDependencyCheckName, run: () => infrastructureViolations(context) }],
  };
  return [
    ...(byRole[role ?? ""] ?? []),
    ...(documentedRuntimeDependencies[context.packageJson.name] === undefined ? [] : [{ name: documentedRuntimeDependencyCheckName, run: () => documentedRuntimeDependencyViolations(context) }]),
    ...(exportedPresets(context.packageJson).length === 0 ? [] : [{ name: presetCheckName, run: () => presetViolations(context) }]),
  ];
}

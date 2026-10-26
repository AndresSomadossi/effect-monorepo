import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { exportsCheckName, exportsViolations } from "#package-boundaries/exports";
import { type CodeRule, codeViolations, type LayerRule, layerViolations, processEnvViolations } from "#package-boundaries/layers";
import { layoutViolations } from "#package-boundaries/layout";
import { migrationsCheckName, migrationViolations } from "#package-boundaries/migrations";
import { matchesPathPattern } from "#package-boundaries/path-pattern";
import { forbiddenTsconfigKeys, roleChecksOf } from "#package-boundaries/role-checks";
import { roleRulesOf } from "#package-boundaries/role-rules";
import { workspaceRoleOf } from "#package-boundaries/roles";
import { classify, extractSpecifiers, isInside, isSkippedDirectory, packageNameOf, type SpecifierSite, typesPackageOf } from "#package-boundaries/source-scan";
import { tsconfigFenceViolations } from "#package-boundaries/tsconfig-fence";
import { type DependencyField, dependencyFields, type PackageJson, readPackageJson } from "#workspace/package-manifest";
import { findRepositoryRoot, listWorkspacePackages, type WorkspacePackage } from "#workspace/workspace";

// Shared boundary checks for every workspace package: the checks every package gets, then the rules and checks of its role (roles.ts).
// Sources: docs/architecture/reference/package-public-surfaces.md, sdk-packages.md, bounded-contexts.md, app-contracts.md and docs/architecture/adr/failures.md.
// Limitations: computed module specifiers such as import(name) are not detected, regex literals containing quotes are not modelled,
// symlinked directories are not followed, and tsconfig files must be plain JSON.

export type BoundaryRules = {
  /** Approved workspace dependencies per package.json field; a field left out approves none. */
  allowedWorkspaceDependencies: Partial<Record<DependencyField, readonly string[]>>;
  /** Package-relative path patterns (`**`, `*`) that the import scan skips. */
  scanExclude?: readonly string[];
  /** Intra-package layer rules, each one check named after the rule. Defaults to the rules of the package's role. */
  internalLayers?: readonly LayerRule[];
  /** Intra-package rules on source text, each one check named after the rule. Defaults to the rules of the package's role. */
  codeRules?: readonly CodeRule[];
  /** src/ files allowed to read process.env; every other src/ file must not read it. Defaults to the rule of the package's role. */
  processEnvAllowedIn?: readonly string[];
};

export type ImportSite = { file: string; rel: string; spec: string; via: SpecifierSite };
export type BoundaryCheck = { name: string; run: () => string[] };
export type BoundaryChecks = {
  checks: readonly BoundaryCheck[];
  packageDirectory: string;
  packageJson: PackageJson;
  /** The package's workspace role, or `undefined` outside a pnpm workspace. */
  role: string | undefined;
  collectImports: () => ImportSite[];
};

const runtimeDependencyFields: readonly DependencyField[] = ["dependencies", "peerDependencies", "optionalDependencies"];
const rangePattern = /^(?:[*^~<>=\d][^@:/]*)?$/;
const sourceFilePattern = /\.[cm]?[jt]sx?$/;
const tsconfigFiles = ["tsconfig.json", "tests/tsconfig.json"];
// docs/architecture/adr/failures.md: @repo/sdk-core owns the public import surface for Result.
const resultOwnerPackageName = "@repo/sdk-core";
// This package's own checker tests hold import-like fixture strings.
const ownScanExclude: Readonly<Record<string, readonly string[]>> = { "@repo/tooling-vitest": ["tests/unit/package-boundaries/**"] };
// Root config files that a framework loads at runtime, so they may use runtime dependency fields only.
const frameworkRuntimeConfigPatterns: readonly RegExp[] = [/^next\.config\.[cm]?[jt]s$/];

// Development files may use every dependency field. Everything else, including package-root files that are not *.config.* files, is runtime code.
function isDevelopmentFile(rel: string): boolean {
  if (rel.startsWith("tests/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) {
    return true;
  }
  return !rel.includes("/") && /\.config\.[cm]?[jt]s$/.test(rel) && !frameworkRuntimeConfigPatterns.some((pattern) => pattern.test(rel));
}

function fieldsFor(rel: string): readonly DependencyField[] {
  return isDevelopmentFile(rel) ? dependencyFields : runtimeDependencyFields;
}

function isPlainDependencyValue(value: string): boolean {
  return value.startsWith("catalog:") || rangePattern.test(value) || (value.startsWith("workspace:") && rangePattern.test(value.slice("workspace:".length)));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exportKeys(exportsField: unknown): { ok: true; keys: Set<string> } | { ok: false; reason: string } {
  if (exportsField === undefined) {
    return { ok: false, reason: "has no explicit exports" };
  }
  if (typeof exportsField === "string") {
    return { ok: true, keys: new Set(["."]) };
  }
  if (typeof exportsField !== "object" || exportsField === null || Array.isArray(exportsField)) {
    return { ok: false, reason: "uses an unsupported exports shape" };
  }
  const entries = Object.entries(exportsField);
  if (entries.some(([, target]) => typeof target !== "string")) {
    return { ok: false, reason: "uses conditional exports, not supported" };
  }
  if (entries.some(([key]) => key.includes("*"))) {
    return { ok: false, reason: "uses pattern exports, not supported" };
  }
  return { ok: true, keys: new Set(entries.map(([key]) => key)) };
}

function flattenTargets(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenTargets);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(flattenTargets);
  }
  return [String(value)];
}

// A package outside any pnpm workspace, such as a throwaway rule fixture, has no workspace role.
function roleOf(packageDirectory: string): string | undefined {
  try {
    return workspaceRoleOf({ root: findRepositoryRoot(packageDirectory), packageDirectory });
  } catch {
    return undefined;
  }
}

/** Builds the boundary checks for one package. Each check returns its violations; an empty array means it passes. */
export function createBoundaryChecks({ packageDirectory, rules }: { packageDirectory: string; rules: BoundaryRules }): BoundaryChecks {
  const packageJson = readPackageJson(packageDirectory);
  const packageName = packageJson.name;
  const scanExclude = [...(rules.scanExclude ?? []), ...(ownScanExclude[packageName] ?? [])];
  const allowed = (field: DependencyField): readonly string[] => rules.allowedWorkspaceDependencies[field] ?? [];
  const ownsResultBackingLibrary = packageName === resultOwnerPackageName;
  let workspacePackages: Map<string, WorkspacePackage> | undefined;

  function workspace(): Map<string, WorkspacePackage> {
    workspacePackages ??= listWorkspacePackages(findRepositoryRoot(packageDirectory));
    return workspacePackages;
  }

  function toRel(path: string): string {
    return relative(packageDirectory, path).split(sep).join("/");
  }

  function listSourceFiles(directory: string): string[] {
    const files = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return isSkippedDirectory(entry.name) || entry.name.startsWith(".") ? [] : listSourceFiles(path);
      }
      return entry.isFile() && sourceFilePattern.test(entry.name) ? [path] : [];
    });
    return files.sort();
  }

  function listSymlinks(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          return [path];
        }
        return entry.isDirectory() && !isSkippedDirectory(entry.name) ? listSymlinks(path) : [];
      })
      .sort();
  }

  function scannedFiles(): { file: string; rel: string }[] {
    return listSourceFiles(packageDirectory)
      .map((file) => ({ file, rel: toRel(file) }))
      .filter(({ rel }) => !scanExclude.some((pattern) => matchesPathPattern(rel, pattern)));
  }

  function readText(file: string): string {
    return readFileSync(file, "utf8");
  }

  function collectImports(): ImportSite[] {
    return scannedFiles().flatMap(({ file, rel }) => extractSpecifiers(readText(file)).map(({ spec, via }) => ({ file, rel, spec, via })));
  }

  function allowedWorkspaceFor(fields: readonly DependencyField[]): Set<string> {
    return new Set(fields.flatMap((field) => allowed(field)));
  }

  function declares(field: DependencyField, name: string): boolean {
    return Object.hasOwn(packageJson[field] ?? {}, name);
  }

  function exportProblem(name: string, key: string): string | undefined {
    const manifest = name === packageName ? packageJson : workspace().get(name)?.manifest;
    if (manifest === undefined) {
      return `${name} is not a workspace package`;
    }
    const result = exportKeys(manifest.exports);
    if (!result.ok) {
      return `${name} ${result.reason}`;
    }
    return result.keys.has(key) ? undefined : `${key} is not an exports key of ${name}`;
  }

  function extendsProblem(directory: string, entry: unknown): string | undefined {
    if (typeof entry !== "string") {
      return "extends entries must be strings";
    }
    if (entry.startsWith("@repo/")) {
      const name = packageNameOf(entry);
      if (name !== packageName && !allowedWorkspaceFor(dependencyFields).has(name)) {
        return `${name} is not an allowed workspace dependency of ${packageName}`;
      }
      return exportProblem(name, `.${entry.slice(name.length)}`);
    }
    if (entry.startsWith(".")) {
      return isInside(packageDirectory, resolve(directory, entry)) ? undefined : "relative extends leaves the package";
    }
    return "only exported @repo presets and files inside the package are allowed";
  }

  function workspaceImportProblem(rel: string, spec: string): string | undefined {
    const name = packageNameOf(spec);
    const rest = spec.slice(name.length);
    if (name !== packageName && !allowedWorkspaceFor(fieldsFor(rel)).has(name)) {
      const devOnly = !isDevelopmentFile(rel) && allowed("devDependencies").includes(name);
      return devOnly ? `${name} is only a devDependency` : `${name} is not an allowed workspace dependency of ${packageName}`;
    }
    if (rest.includes("/src/") || rest.endsWith("/src")) {
      return "deep import into src/";
    }
    return exportProblem(name, `.${rest}`);
  }

  // Satisfied when any candidate is declared in a field the file may use; `name` is the package reported in the message.
  function undeclaredProblem(rel: string, name: string, candidates: readonly string[]): string | undefined {
    if (fieldsFor(rel).some((field) => candidates.some((candidate) => declares(field, candidate)))) {
      return undefined;
    }
    return candidates.some((candidate) => declares("devDependencies", candidate)) ? `${name} is only a devDependency` : `${name} is not declared in package.json`;
  }

  // A2: `/// <reference types="X">`. `node` needs @types/node; @repo/* and relative values are left to U2 and U3; anything else needs X or @types/X.
  function typeReferenceProblem(rel: string, spec: string): string | undefined {
    if (spec === "node") {
      return dependencyFields.some((field) => declares(field, "@types/node")) ? undefined : "@types/node is not declared in package.json";
    }
    const kind = classify(spec);
    if (kind === "workspace" || kind === "relative" || kind === "absolute" || kind === "subpath-import") {
      return undefined;
    }
    const name = packageNameOf(spec);
    return undeclaredProblem(rel, name, [name, typesPackageOf(name)]);
  }

  function readTsconfigs(): { rel: string; path: string; config: unknown }[] {
    return tsconfigFiles.filter((rel) => existsSync(join(packageDirectory, rel))).map((rel) => ({ rel, path: join(packageDirectory, rel), config: readJson(join(packageDirectory, rel)) }));
  }

  // U1: package.json workspace dependencies match the approved rules, and every value is a plain range.
  function checkWorkspaceDependencies(): string[] {
    return dependencyFields.flatMap((field) => {
      const declared = packageJson[field] ?? {};
      const approved = allowed(field);
      const workspaceKeys = Object.keys(declared).filter((key) => key.startsWith("@repo/"));
      return [
        ...workspaceKeys.filter((key) => !approved.includes(key)).map((key) => `package.json ${field} declares ${key}: not an allowed workspace dependency of ${packageName}`),
        ...approved.filter((name) => !workspaceKeys.includes(name)).map((name) => `package.json ${field} is missing allowed ${name}: update tests/package-boundaries.test.ts or package.json`),
        ...Object.entries(declared)
          .filter(([, value]) => !isPlainDependencyValue(String(value)))
          .map(([key, value]) => `package.json ${field} ${key} uses ${String(value)}: only semver ranges, catalog: and workspace: ranges are allowed`),
      ];
    });
  }

  // U2: workspace imports use only approved packages, never their src/ tree, and only their exports keys.
  function checkWorkspaceImports(): string[] {
    return collectImports()
      .filter(({ spec }) => classify(spec) === "workspace")
      .flatMap(({ rel, spec }) => {
        const problem = workspaceImportProblem(rel, spec);
        return problem === undefined ? [] : [`${rel} imports ${spec}: ${problem}`];
      });
  }

  // U3: relative imports stay inside the package and outside node_modules; absolute paths are never allowed.
  function checkRelativeImports(): string[] {
    return collectImports().flatMap(({ file, rel, spec }) => {
      const kind = classify(spec);
      if (kind === "absolute") {
        return [`${rel} imports ${spec}: absolute paths bypass package boundaries`];
      }
      if (kind !== "relative") {
        return [];
      }
      const target = resolve(dirname(file), spec);
      if (!isInside(packageDirectory, target)) {
        return [`${rel} imports ${spec}: relative import leaves the package`];
      }
      return relative(packageDirectory, target).split(sep).includes("node_modules") ? [`${rel} imports ${spec}: relative import into node_modules`] : [];
    });
  }

  // U4: external imports and type references are declared in a dependency field that the importing file may use.
  function checkDeclaredImports(): string[] {
    return collectImports().flatMap(({ rel, spec, via }) => {
      if (via === "reference-types") {
        const problem = typeReferenceProblem(rel, spec);
        return problem === undefined ? [] : [`${rel} references types ${spec}: ${problem}`];
      }
      if (classify(spec) !== "external") {
        return [];
      }
      const name = packageNameOf(spec);
      const problem = undeclaredProblem(rel, name, [name]);
      return problem === undefined ? [] : [`${rel} imports ${spec}: ${problem}`];
    });
  }

  // U5: only @repo/sdk-core, which owns Result, may declare or import its backing library.
  function checkResultBackingLibrary(): string[] {
    if (ownsResultBackingLibrary) {
      return [];
    }
    return [
      ...dependencyFields.filter((field) => declares(field, "neverthrow")).map((field) => `package.json ${field} declares neverthrow: import Result from @repo/sdk-core`),
      ...collectImports()
        .filter(({ spec }) => packageNameOf(spec) === "neverthrow")
        .map(({ rel, spec }) => `${rel} imports ${spec}: import Result from @repo/sdk-core`),
    ];
  }

  // U6: tsconfig files extend only exported presets of approved packages and define no path aliases.
  function checkTsconfigFiles(): string[] {
    return readTsconfigs().flatMap(({ rel, path, config }) => {
      const extendsField = (config as { extends?: unknown }).extends;
      const entries: unknown[] = Array.isArray(extendsField) ? extendsField : extendsField === undefined ? [] : [extendsField];
      return [
        ...entries.flatMap((entry) => {
          const problem = extendsProblem(dirname(path), entry);
          return problem === undefined ? [] : [`${rel} extends ${String(entry)}: ${problem}`];
        }),
        ...forbiddenTsconfigKeys(config).map((key) => `${rel} ${key} is not allowed: it can alias another package's internals`),
      ];
    });
  }

  // U7: package.json imports (#…) map only into the package's own src/.
  function checkSubpathImports(): string[] {
    const field = packageJson.imports;
    if (field === undefined) {
      return [];
    }
    if (typeof field !== "object" || field === null || Array.isArray(field)) {
      return ["package.json imports must be an object"];
    }
    return Object.entries(field).flatMap(([key, value]) =>
      flattenTargets(value).flatMap((target) => {
        if (!target.startsWith("./src/")) {
          return [`package.json imports ${key} targets ${target}: imports must map into ./src/`];
        }
        const escapes = target
          .split("/")
          .slice(1)
          .some((segment) => segment === ".." || segment === "." || segment === "node_modules");
        return escapes ? [`package.json imports ${key} targets ${target}: target segments must not contain .. or node_modules`] : [];
      }),
    );
  }

  // A1: symlinks can point anywhere, so none are allowed outside build output and tool caches.
  function checkSymlinks(): string[] {
    return listSymlinks(packageDirectory).map((path) => `${toRel(path)}: symlinks are not allowed inside a package`);
  }

  // A3: tsconfig include, exclude and files entries cannot pull other packages' files into this package's program.
  function checkTsconfigFence(): string[] {
    return readTsconfigs().flatMap(({ rel, path, config }) => tsconfigFenceViolations({ label: rel, config, configDirectory: dirname(path), packageDirectory }));
  }

  function checkLayer(rule: LayerRule): string[] {
    return layerViolations({ rule, imports: collectImports(), packageDirectory, importsField: packageJson.imports, readText });
  }

  // Role rules apply by workspace location, not by opt-in rules, so every package of the role gets them.
  const role = roleOf(packageDirectory);
  const roleRules = roleRulesOf(role, packageJson);
  const internalLayers = rules.internalLayers ?? roleRules.internalLayers;
  const codeRules = rules.codeRules ?? roleRules.codeRules;
  const processEnvAllowedIn = rules.processEnvAllowedIn ?? roleRules.processEnvAllowedIn;
  const roleOfWorkspacePackage = (name: string): string | undefined => {
    const dir = workspace().get(name)?.dir;
    return dir === undefined ? undefined : workspaceRoleOf({ root: findRepositoryRoot(packageDirectory), packageDirectory: dir });
  };
  const repositoryManifests = (): PackageJson[] => [readPackageJson(findRepositoryRoot(packageDirectory)), ...[...workspace().values()].map(({ manifest }) => manifest)];
  const roleChecks = roleChecksOf(role, { packageDirectory, packageJson, collectImports, scannedFiles, readText, roleOfWorkspacePackage, repositoryManifests });
  const checks: readonly BoundaryCheck[] = [
    { name: "declares only allowed workspace dependencies", run: checkWorkspaceDependencies },
    { name: "imports other workspace packages only through their exports", run: checkWorkspaceImports },
    { name: "keeps relative imports inside the package", run: checkRelativeImports },
    { name: "declares every package it imports", run: checkDeclaredImports },
    { name: ownsResultBackingLibrary ? "owns the Result backing library" : "does not use the Result backing library directly", run: checkResultBackingLibrary },
    { name: "uses only exported tsconfig presets and no path aliases", run: checkTsconfigFiles },
    { name: "maps subpath imports only into its own src", run: checkSubpathImports },
    { name: "contains no symlinks", run: checkSymlinks },
    { name: "keeps tsconfig include, exclude and files inside the package", run: checkTsconfigFence },
    { name: "keeps files in the standard package layout", run: () => layoutViolations(packageDirectory, { role }) },
    { name: exportsCheckName, run: () => exportsViolations({ packageDirectory, exportsField: packageJson.exports, role }) },
    { name: migrationsCheckName, run: () => migrationViolations(packageDirectory) },
    ...internalLayers.map((rule) => ({ name: rule.name, run: () => checkLayer(rule) })),
    ...codeRules.map((rule) => ({ name: rule.name, run: () => codeViolations({ rule, files: scannedFiles(), readText }) })),
    ...(processEnvAllowedIn === undefined ? [] : [{ name: "reads process.env only in composition config", run: () => processEnvViolations({ files: scannedFiles(), allowedIn: processEnvAllowedIn, readText }) }]),
    ...roleChecks,
  ];

  return { checks, packageDirectory, packageJson, role, collectImports };
}

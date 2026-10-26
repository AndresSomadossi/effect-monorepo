import { dirname, relative, resolve, sep } from "node:path";

import { matchesPathPattern } from "#package-boundaries/path-pattern";
import { classify, packageNameOf, stripComments } from "#package-boundaries/source-scan";

/** One intra-package layer rule. Path patterns are package-relative and match extensionless paths (`x/**` also matches `x` and `x/index`). */
export type LayerRule = {
  /** Used as the check name. */
  name: string;
  /** Doc citation included in every violation. */
  source: string;
  /** Importing files the rule applies to. Only files under src/ are checked. */
  from: readonly string[];
  /** Importing files exempt from the rule. */
  except?: readonly string[];
  /** Apply only to files whose first statement is this directive. */
  fromDirective?: "use client";
  /** Forbidden internal target patterns, or `package:<name>` for bare packages. */
  mayNotImport?: readonly string[];
  /** Internal targets must match one of these patterns. Bare packages are unaffected. */
  mayImportOnly?: readonly string[];
};

export type LayerImportSite = { file: string; rel: string; spec: string };

/** One intra-package rule on source text rather than imports, for constraints such as property reads that no import reveals. */
export type CodeRule = {
  /** Used as the check name. */
  name: string;
  /** Doc citation included in every violation. */
  source: string;
  /** Files the rule applies to. Only files under src/ are checked. */
  from: readonly string[];
  /** Files exempt from the rule. */
  except?: readonly string[];
  /** Code that must not appear, matched after comments are stripped. String literals are kept, so computed access such as `ctx["native"]` matches too. */
  mayNotMatch: RegExp;
};

const packagePrefix = "package:";
const sourceExtensionPattern = /\.[cm]?[jt]sx?$/;

/** Strips a source extension and a trailing `/index`, so `src/a/index.ts`, `src/a/index` and `src/a` compare equal. */
export function normalizeModulePath(path: string): string {
  const withoutExtension = path.replace(sourceExtensionPattern, "");
  return withoutExtension === "index" ? "" : withoutExtension.replace(/\/index$/, "");
}

export function matchesLayerPattern(path: string, pattern: string): boolean {
  return matchesPathPattern(normalizeModulePath(path), normalizeModulePath(pattern));
}

function firstTarget(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(firstTarget).find((target) => target !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value)
      .map(firstTarget)
      .find((target) => target !== undefined);
  }
  return undefined;
}

// Exact keys first, then the longest pattern prefix, as Node resolves package.json imports.
function subpathTarget(spec: string, importsField: unknown): string | undefined {
  if (typeof importsField !== "object" || importsField === null || Array.isArray(importsField)) {
    return undefined;
  }
  const entries = Object.entries(importsField).sort(([a], [b]) => Number(a.includes("*")) - Number(b.includes("*")) || b.length - a.length);
  for (const [key, value] of entries) {
    const star = key.indexOf("*");
    if (star === -1) {
      if (key === spec) {
        return firstTarget(value);
      }
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix)) {
      return firstTarget(value)?.replaceAll("*", spec.slice(prefix.length, spec.length - suffix.length));
    }
  }
  return undefined;
}

/** Package-relative, extensionless path of a relative or `#` import, or undefined for bare packages and unresolvable specifiers. */
export function resolveInternalTarget({ file, spec, packageDirectory, importsField }: { file: string; spec: string; packageDirectory: string; importsField: unknown }): string | undefined {
  const kind = classify(spec);
  if (kind === "relative") {
    return normalizeModulePath(
      relative(packageDirectory, resolve(dirname(file), spec))
        .split(sep)
        .join("/"),
    );
  }
  if (kind === "subpath-import") {
    const target = subpathTarget(spec, importsField);
    return target === undefined ? undefined : normalizeModulePath(target.replace(/^\.\//, ""));
  }
  return undefined;
}

/** True when the first statement, after comments and whitespace, is the given directive. */
export function hasLeadingDirective(text: string, directive: string): boolean {
  const code = stripComments(text).trimStart();
  return code.startsWith(`"${directive}"`) || code.startsWith(`'${directive}'`);
}

function appliesTo(rule: LayerRule, rel: string, readText: (file: string) => string, file: string): boolean {
  if (!rel.startsWith("src/") || !rule.from.some((pattern) => matchesLayerPattern(rel, pattern))) {
    return false;
  }
  if (rule.except?.some((pattern) => matchesLayerPattern(rel, pattern))) {
    return false;
  }
  return rule.fromDirective === undefined || hasLeadingDirective(readText(file), rule.fromDirective);
}

function isForbidden(rule: LayerRule, spec: string, target: string | undefined): boolean {
  const kind = classify(spec);
  const isBare = kind === "external" || kind === "workspace" || kind === "builtin";
  const forbidden = (rule.mayNotImport ?? []).some((pattern) => {
    if (pattern.startsWith(packagePrefix)) {
      return isBare && packageNameOf(spec) === pattern.slice(packagePrefix.length);
    }
    return target !== undefined && matchesLayerPattern(target, pattern);
  });
  const outsideAllowed = rule.mayImportOnly !== undefined && target !== undefined && !rule.mayImportOnly.some((pattern) => matchesLayerPattern(target, pattern));
  return forbidden || outsideAllowed;
}

/** Violations of one layer rule as `<rel> imports <spec>: <rule.name> (<rule.source>)`. */
export function layerViolations({ rule, imports, packageDirectory, importsField, readText }: { rule: LayerRule; imports: readonly LayerImportSite[]; packageDirectory: string; importsField: unknown; readText: (file: string) => string }): string[] {
  return imports
    .filter(({ file, rel }) => appliesTo(rule, rel, readText, file))
    .filter(({ file, spec }) => isForbidden(rule, spec, resolveInternalTarget({ file, spec, packageDirectory, importsField })))
    .map(({ rel, spec }) => `${rel} imports ${spec}: ${rule.name} (${rule.source})`);
}

/** Files under src/ that read `process.env` outside the allowed patterns. */
export function processEnvViolations({ files, allowedIn, readText }: { files: readonly { file: string; rel: string }[]; allowedIn: readonly string[]; readText: (file: string) => string }): string[] {
  return files
    .filter(({ rel }) => rel.startsWith("src/") && !allowedIn.some((pattern) => matchesLayerPattern(rel, pattern)))
    .filter(({ file }) => /\bprocess\.env\b/.test(stripComments(readText(file))))
    .map(({ rel }) => `${rel} reads process.env: only ${allowedIn.join(", ")} may read runtime config`);
}

/** Violations of one code rule as `<rel>:<line> uses <match>: <rule.name> (<rule.source>)`. */
export function codeViolations({ rule, files, readText }: { rule: CodeRule; files: readonly { file: string; rel: string }[]; readText: (file: string) => string }): string[] {
  const pattern = new RegExp(rule.mayNotMatch.source, rule.mayNotMatch.flags.includes("g") ? rule.mayNotMatch.flags : `${rule.mayNotMatch.flags}g`);
  return files
    .filter(({ rel }) => rel.startsWith("src/") && rule.from.some((candidate) => matchesLayerPattern(rel, candidate)) && !rule.except?.some((candidate) => matchesLayerPattern(rel, candidate)))
    .flatMap(({ file, rel }) => {
      const code = stripComments(readText(file));
      return [...code.matchAll(pattern)].map((match) => `${rel}:${code.slice(0, match.index).split("\n").length} uses ${match[0]}: ${rule.name} (${rule.source})`);
    });
}

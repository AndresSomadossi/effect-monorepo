import { builtinModules } from "node:module";
import { isAbsolute, relative, sep } from "node:path";

export type SpecifierKind = "builtin" | "subpath-import" | "relative" | "absolute" | "workspace" | "external";
/** How a specifier appears in a file: a module specifier or a triple-slash `path` / `types` reference. */
export type SpecifierSite = "import" | "reference-path" | "reference-types";
export type ExtractedSpecifier = { spec: string; via: SpecifierSite };
type ScanState = "code" | "line-comment" | "block-comment" | '"' | "'" | "`";

// The patterns below contain quotes, so they are built from strings: the scanner does not model quotes inside regex literals.
const quote = "[\"']";
const quoted = `${quote}([^"']+)${quote}`;
// Skips words inside string literals and identifiers, such as "import" or "subpath-import", whose closing quote would otherwise start a specifier.
const notAfterQuote = "(?<![\\w$.\"'`-])";
// Triple-slash directives are comments, so they are collected from the raw text before comments are stripped.
const tripleSlashPattern = new RegExp(`^[ \\t]*\\/\\/\\/[ \\t]*<reference[ \\t]+(path|types)[ \\t]*=[ \\t]*${quoted}`, "gm");
const specifierPatterns: readonly RegExp[] = [
  new RegExp(`${notAfterQuote}\\b(?:import|export)\\s+(?:type\\s+)?[^"']*?\\bfrom\\s*${quoted}`, "g"),
  new RegExp(`${notAfterQuote}\\bimport\\s*${quoted}`, "g"),
  new RegExp(`${notAfterQuote}\\bimport\\s*\\(\\s*${quoted}\\s*\\)`, "g"),
  new RegExp(`\\b(?:vi\\.(?:mock|doMock|unmock|importActual|importMock)|import\\.meta\\.resolve|require(?:\\.resolve)?)\\s*\\(\\s*${quoted}`, "g"),
];
const skippedDirectoryNames = new Set(["node_modules", "dist", "build", "out", "coverage", ".next", ".turbo", ".cache"]);

/** Build output and tool caches that no package check walks into. */
export function isSkippedDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name) || name.startsWith("dist-");
}

export function isInside(base: string, target: string): boolean {
  const path = relative(base, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

// Replaces comments with spaces and keeps strings, so "//" inside a string does not hide the rest of the line.
export function stripComments(text: string): string {
  let state: ScanState = "code";
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && (next === "/" || next === "*")) {
        state = next === "/" ? "line-comment" : "block-comment";
        output += "  ";
        index += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        state = char;
      }
      output += char;
    } else if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
      }
      output += char === "\n" ? "\n" : " ";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        output += "  ";
        index += 1;
        continue;
      }
      output += char === "\n" ? "\n" : " ";
    } else {
      output += char;
      if (char === "\\") {
        output += next;
        index += 1;
      } else if (char === state || (char === "\n" && state !== "`")) {
        state = "code";
      }
    }
  }
  return output;
}

export function extractSpecifiers(text: string): ExtractedSpecifier[] {
  const references = [...text.matchAll(tripleSlashPattern)].flatMap((match): ExtractedSpecifier[] => {
    const value = match[2];
    if (value === undefined) {
      return [];
    }
    if (match[1] === "types") {
      return [{ spec: value, via: "reference-types" }];
    }
    // TypeScript resolves reference paths relative to the file, so a bare path is relative too.
    return [{ spec: /^(?:\.{1,2}\/|\/)/.test(value) ? value : `./${value}`, via: "reference-path" }];
  });
  const code = stripComments(text);
  const specifiers = specifierPatterns.flatMap((pattern) => [...code.matchAll(pattern)].flatMap((match): ExtractedSpecifier[] => (match[1] === undefined ? [] : [{ spec: match[1], via: "import" }])));
  return [...references, ...specifiers];
}

export function classify(spec: string): SpecifierKind {
  if (spec.startsWith("node:") || builtinModules.includes(spec)) {
    return "builtin";
  }
  if (spec.startsWith("#")) {
    return "subpath-import";
  }
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    return "relative";
  }
  if (spec.startsWith("/") || spec.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(spec)) {
    return "absolute";
  }
  return spec.startsWith("@repo/") ? "workspace" : "external";
}

export function packageNameOf(spec: string): string {
  const segments = spec.split("/");
  return spec.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? spec);
}

/** DefinitelyTyped package for a package name: `x` -> `@types/x`, `@a/b` -> `@types/a__b`. */
export function typesPackageOf(name: string): string {
  return name.startsWith("@") ? `@types/${name.slice(1).replace("/", "__")}` : `@types/${name}`;
}

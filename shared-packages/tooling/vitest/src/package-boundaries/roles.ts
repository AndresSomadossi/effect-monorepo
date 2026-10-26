import { relative, sep } from "node:path";

// A package's role follows from where it lives, so every rule of a role applies to every package of that role: a new package cannot
// opt out by omission, and its package-boundaries test declares nothing but the workspace dependencies it may use.

/** The role of a deployable app, `apps/<app>`. */
export const appRole = "app";

/** The role of a bounded context's package, `contexts/<context>`: its entities, business rules, services, outbound ports and their adapters. */
export const contextRole = "context";

/** The roles of shared packages, `shared-packages/<kind>/<name>`: one per kind (package-public-surfaces.md Shared Packages). */
export const libRole = "lib";
export const sdkRole = "sdk";
export const runtimeRole = "runtime";
export const toolingRole = "tooling";

/** The role of an infrastructure package, `infrastructure/<name>`. */
export const infrastructureRole = "infrastructure";

const sharedPackageRoles: readonly string[] = [libRole, sdkRole, runtimeRole, toolingRole];

/**
 * The workspace role of a package, from its location. bounded-contexts.md: `contexts/<context>` is one bounded context, a support context
 * such as `contexts/platform` included. `apps/*` are apps and `shared-packages/<kind>/*` take their kind. Any other package takes the first
 * directory of its path from the repository root, such as `infrastructure` or `scripts`.
 */
export function workspaceRoleOf({ root, packageDirectory }: { root: string; packageDirectory: string }): string {
  const [first = "", second, third] = relative(root, packageDirectory).split(sep);
  if (first === "contexts" && second !== undefined && third === undefined) {
    return contextRole;
  }
  if (first === "apps" && second !== undefined) {
    return appRole;
  }
  if (first === "shared-packages" && second !== undefined && sharedPackageRoles.includes(second)) {
    return second;
  }
  return first;
}

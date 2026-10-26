import { isAbsolute, resolve } from "node:path";

import { isInside } from "#package-boundaries/source-scan";

export type TsconfigFenceInput = {
  /** Label used at the start of each violation, such as `tests/tsconfig.json`. */
  label: string;
  /** Parsed tsconfig JSON. */
  config: unknown;
  /** Directory that holds the tsconfig file; entries resolve from here. */
  configDirectory: string;
  packageDirectory: string;
};

const fencedKeys = ["include", "exclude", "files"] as const;

/** Every include, exclude and files entry must resolve inside the package: its static prefix (before the first `*`, `?` or `{`) is resolved from the tsconfig directory. */
export function tsconfigFenceViolations({ label, config, configDirectory, packageDirectory }: TsconfigFenceInput): string[] {
  if (typeof config !== "object" || config === null) {
    return [];
  }
  const record = config as Record<string, unknown>;
  return fencedKeys.flatMap((key) => {
    const value = record[key];
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      return [`${label} ${key} must be an array`];
    }
    return value.flatMap((entry: unknown) => {
      if (typeof entry !== "string") {
        return [`${label} ${key} entries must be strings`];
      }
      if (isAbsolute(entry) || /^[A-Za-z]:[\\/]/.test(entry)) {
        return [`${label} ${key} ${entry}: absolute paths are not allowed`];
      }
      const prefix = entry.split(/[*?{]/)[0] ?? "";
      return isInside(packageDirectory, resolve(configDirectory, prefix)) ? [] : [`${label} ${key} ${entry}: entry leaves the package`];
    });
  });
}

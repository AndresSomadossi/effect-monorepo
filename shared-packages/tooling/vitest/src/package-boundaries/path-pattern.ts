/** Matches a package-relative `/` path against a pattern where `**` spans segments and `*` stays inside one segment. A trailing `/**` also matches the directory itself. */
export function matchesPathPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith("/**") && path === pattern.slice(0, -"/**".length)) {
    return true;
  }
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`).test(path);
}

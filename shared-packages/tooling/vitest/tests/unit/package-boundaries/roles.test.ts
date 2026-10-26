import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { workspaceRoleOf } from "#package-boundaries/index";

const roleAt = (path: string) => workspaceRoleOf({ root: "/repo", packageDirectory: join("/repo", ...path.split("/")) });

describe("workspace roles", () => {
  test("follow from where a package lives", () => {
    expect(
      ["apps/api", "contexts/invoicing", "contexts/platform", "shared-packages/lib/postgres", "shared-packages/sdk/core", "shared-packages/runtime/fastify", "shared-packages/tooling/vitest", "infrastructure/supabase-invoicing", "scripts"].map(
        roleAt,
      ),
    ).toEqual(["app", "context", "context", "lib", "sdk", "runtime", "tooling", "infrastructure", "scripts"]);
  });
});

// AGENTS: never edit this file without the user's explicit permission. Ask first, and say which dependency you want to add or remove and why.
// It declares the workspace packages this package may depend on; every other rule follows from the package's role
// (docs/architecture/reference/package-boundaries.md). Approve a new edge here in the same change as package.json.
import { packageBoundaries } from "@repo/tooling-vitest/package-boundaries";

// Every package devDepends on this one for its tests and Vitest config, so it depends on no workspace package.
packageBoundaries(import.meta.url, {});

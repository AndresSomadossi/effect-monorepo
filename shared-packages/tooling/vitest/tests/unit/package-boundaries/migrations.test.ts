import { describe, expect } from "vitest";

import { type Fixture, type MakeFixture, test } from "../../support/checker-fixture.ts";

const migrations = "classifies every migration in its migrations/manifest.json";
// A Postgres adapter's migrations live in its folder (persistence.md).
const dir = "src/outbound/customer-repository/postgres/migrations";
const layout = "keeps files in the standard package layout";

const entry = (id: string, fields: Record<string, unknown> = {}) => ({ id, issue: "customers-postgres", phase: "before-code", description: "Creates the customers table.", ...fields });
const manifestOf = (...entries: unknown[]) => `${JSON.stringify({ migrations: entries }, null, 2)}\n`;

const contextFixture = (makeFixture: MakeFixture): Fixture => makeFixture({ packagePath: "contexts/target" });

describe("migration manifest", () => {
  test("passes when every migration file has a classified manifest entry, in id order", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/20261022090000_add_customer_index.sql`, "create index on customers.customers (email);\n");
    target.write(`${dir}/manifest.json`, manifestOf(entry("20261021120000_create_customers"), entry("20261022090000_add_customer_index", { phase: "after-code" })));

    expect([target.run(migrations), target.run(layout)]).toEqual([[], []]);
  });

  test("fails a migration without phase metadata, and one whose phase is unknown", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    const { phase: _phase, ...unphased } = entry("20261021120000_create_customers");
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/20261022090000_add_customer_index.sql`, "create index on customers.customers (email);\n");
    target.write(`${dir}/manifest.json`, manifestOf(unphased, entry("20261022090000_add_customer_index", { phase: "whenever" })));

    expect(target.run(migrations)).toEqual([
      `${dir}/manifest.json 20261021120000_create_customers: phase must be one of before-code, with-code, after-code, manual`,
      `${dir}/manifest.json 20261022090000_add_customer_index: phase must be one of before-code, with-code, after-code, manual`,
    ]);
  });

  test("fails a migration without its issue or description", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/manifest.json`, manifestOf(entry("20261021120000_create_customers", { issue: "", description: undefined })));

    expect(target.run(migrations)).toEqual([`${dir}/manifest.json 20261021120000_create_customers: description must be a non-empty string`, `${dir}/manifest.json 20261021120000_create_customers: issue must be a non-empty string`]);
  });

  test("fails when the migration files and the manifest disagree", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/manifest.json`, manifestOf(entry("20261023000000_drop_legacy")));

    expect(target.run(migrations)).toEqual([`${dir}/20261021120000_create_customers.sql: has no entry in ${dir}/manifest.json`, `${dir}/manifest.json 20261023000000_drop_legacy: has no ${dir}/20261023000000_drop_legacy.sql`]);
  });

  test("fails ids that are not timestamp-prefixed, repeated, or listed out of id order", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    for (const id of ["20261022090000_add_index", "20261021120000_create_customers", "create_more"]) {
      target.write(`${dir}/${id}.sql`, "select 1;\n");
    }
    target.write(`${dir}/manifest.json`, manifestOf(entry("20261022090000_add_index"), entry("20261021120000_create_customers"), entry("20261021120000_create_customers"), entry("create_more")));

    expect(target.run(migrations)).toEqual([
      `${dir}/manifest.json 20261021120000_create_customers: listed after 20261022090000_add_index; list migrations in id order`,
      `${dir}/manifest.json 20261021120000_create_customers: listed more than once`,
      `${dir}/manifest.json create_more: id must be <14-digit UTC timestamp>_<snake_case description>`,
    ]);
  });

  test("fails a migrations directory without a readable manifest, or holding other files", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/notes.md`, "draft\n");

    expect(target.run(migrations)).toEqual([`${dir}/manifest.json: missing or not valid JSON`, `${dir}/notes.md: migrations/ holds only <id>.sql files and manifest.json`]);
  });

  test("checks each adapter's migrations on its own", ({ makeFixture }) => {
    const target = contextFixture(makeFixture);
    const other = "src/outbound/payment-reminder-repository/postgres/migrations";
    target.write(`${dir}/20261021120000_create_customers.sql`, "create schema customers;\n");
    target.write(`${dir}/manifest.json`, manifestOf(entry("20261021120000_create_customers")));
    target.write(`${other}/20261022110000_create_payment_reminders.sql`, "create table invoicing.payment_reminders ();\n");
    target.write(`${other}/manifest.json`, manifestOf());

    expect(target.run(migrations)).toEqual([`${other}/20261022110000_create_payment_reminders.sql: has no entry in ${other}/manifest.json`]);
  });

  test("passes a package without migrations", ({ makeFixture }) => {
    expect(contextFixture(makeFixture).run(migrations)).toEqual([]);
  });

  test("keeps migrations out of the package root, contexts included", ({ makeFixture }) => {
    const fixture = makeFixture({ packagePath: "contexts/target" });
    fixture.write("migrations/manifest.json", manifestOf());

    expect(fixture.run(layout)).toEqual(["migrations/manifest.json: files must live in src/ or tests/ (see package-public-surfaces.md Package Layout)"]);
  });
});

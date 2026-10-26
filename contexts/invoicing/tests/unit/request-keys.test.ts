import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Result } from "effect";

import { Actor, InvoiceId, InvoiceNotFound, MemoryRequestKeys, RequestKey, RequestKeys } from "#index";

const ops = Actor.make("ops");
const key = RequestKey.make("k-1");
const at = (iso: string) => DateTime.makeUnsafe(iso);
const refusal = Result.fail(new InvoiceNotFound({ invoiceId: InvoiceId.make("X") }));

describe("MemoryRequestKeys", () => {
  it.effect("hands a free key to the first claim only", () =>
    Effect.gen(function* () {
      const keys = yield* RequestKeys;
      const first = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:00Z") });
      const second = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:01Z") });
      assert.strictEqual(first._tag, "Claimed");
      assert.strictEqual(second._tag, "InProgress");
    }).pipe(Effect.provide(MemoryRequestKeys.layer)),
  );

  it.effect("answers the same request with its kept answer, and refuses a different one", () =>
    Effect.gen(function* () {
      const keys = yield* RequestKeys;
      yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:00Z") });
      yield* keys.complete({ actor: ops, requestKey: key, answer: refusal });
      const same = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T01:00:00Z") });
      const different = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "b", now: at("2026-10-25T01:00:00Z") });
      assert.deepStrictEqual(same, { _tag: "Answered", answer: refusal });
      assert.strictEqual(different._tag, "Reused");
    }).pipe(Effect.provide(MemoryRequestKeys.layer)),
  );

  it.effect("holds a key for 24 hours only", () =>
    Effect.gen(function* () {
      const keys = yield* RequestKeys;
      yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:00Z") });
      yield* keys.complete({ actor: ops, requestKey: key, answer: refusal });
      const justBefore = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "b", now: at("2026-10-25T23:59:59Z") });
      const after = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "b", now: at("2026-10-26T00:00:00Z") });
      assert.strictEqual(justBefore._tag, "Reused");
      assert.strictEqual(after._tag, "Claimed");
    }).pipe(Effect.provide(MemoryRequestKeys.layer)),
  );

  it.effect("gives a released key back", () =>
    Effect.gen(function* () {
      const keys = yield* RequestKeys;
      yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:00Z") });
      yield* keys.release({ actor: ops, requestKey: key });
      const again = yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:01Z") });
      assert.strictEqual(again._tag, "Claimed");
    }).pipe(Effect.provide(MemoryRequestKeys.layer)),
  );

  it.effect("keeps each caller's keys apart", () =>
    Effect.gen(function* () {
      const keys = yield* RequestKeys;
      yield* keys.claim({ actor: ops, requestKey: key, fingerprint: "a", now: at("2026-10-25T00:00:00Z") });
      const other = yield* keys.claim({ actor: Actor.make("other"), requestKey: key, fingerprint: "b", now: at("2026-10-25T00:00:00Z") });
      assert.strictEqual(other._tag, "Claimed");
    }).pipe(Effect.provide(MemoryRequestKeys.layer)),
  );
});

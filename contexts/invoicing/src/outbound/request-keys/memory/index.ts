import { DateTime, Effect, HashMap, Layer, Option, Ref } from "effect";

import { type KeyedRequest, type RequestAnswer, RequestKeyClaim, RequestKeys } from "#outbound/request-keys/index";

interface Entry {
  readonly fingerprint: string;
  readonly claimedAt: DateTime.Utc;
  readonly answer: Option.Option<RequestAnswer>;
}

const holdFor = { hours: 24 } as const;

const entryKey = ({ actor, requestKey }: KeyedRequest): string => JSON.stringify([actor, requestKey]);

/** An in-memory `RequestKeys`. `Ref.modify` makes each claim atomic. Expired entries are replaced when their key is claimed again. */
export const layer: Layer.Layer<RequestKeys> = Layer.effect(
  RequestKeys,
  Effect.gen(function* () {
    const entries = yield* Ref.make(HashMap.empty<string, Entry>());

    return RequestKeys.of({
      claim: (request) =>
        Ref.modify(entries, (state): [RequestKeyClaim, HashMap.HashMap<string, Entry>] => {
          const key = entryKey(request);
          const held = HashMap.get(state, key).pipe(Option.filter((entry) => DateTime.isLessThan(request.now, DateTime.add(entry.claimedAt, holdFor))));
          if (Option.isNone(held)) {
            return [RequestKeyClaim.Claimed(), HashMap.set(state, key, { fingerprint: request.fingerprint, claimedAt: request.now, answer: Option.none() })];
          }
          if (held.value.fingerprint !== request.fingerprint) {
            return [RequestKeyClaim.Reused(), state];
          }
          return Option.match(held.value.answer, {
            onNone: () => [RequestKeyClaim.InProgress(), state],
            onSome: (answer) => [RequestKeyClaim.Answered({ answer }), state],
          });
        }),

      complete: (request) =>
        Ref.update(entries, (state) =>
          HashMap.modify(state, entryKey(request), (entry) => ({
            ...entry,
            answer: Option.some(request.answer),
          })),
        ),

      release: (request) => Ref.update(entries, HashMap.remove(entryKey(request))),
    });
  }),
);

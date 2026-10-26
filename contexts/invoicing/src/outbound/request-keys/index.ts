import { Context, Data, type DateTime, type Effect, type Result } from "effect";

import type { IssuedInvoice } from "#entities/invoice/index";
import type { IssueRefusal } from "#entities/refusals/index";
import type { Actor, RequestKey } from "#entities/request/index";

/** The answer a request received, kept so the same request sent again receives it again. */
export type RequestAnswer = Result.Result<IssuedInvoice, IssueRefusal>;

/** What claiming a request key found. */
export type RequestKeyClaim = Data.TaggedEnum<{
  /** The key was free, or its earlier use expired: the request is now this caller's to handle. */
  Claimed: Record<never, never>;
  /** The same request was already answered: here is that answer. */
  Answered: { readonly answer: RequestAnswer };
  /** The key was used for a different request. */
  Reused: Record<never, never>;
  /** The same request is still being handled. */
  InProgress: Record<never, never>;
}>;
export const RequestKeyClaim = Data.taggedEnum<RequestKeyClaim>();

export interface KeyedRequest {
  readonly actor: Actor;
  readonly requestKey: RequestKey;
}

/**
 * Where request keys and the answers given to them are kept, per caller: two callers using the same key never affect each other. A key
 * is held for 24 hours from the moment it is claimed.
 */
export class RequestKeys extends Context.Service<
  RequestKeys,
  {
    /** Claims the key for the request identified by `fingerprint`, unless it is already held. Atomic: of two claims, only one is `Claimed`. */
    claim(request: KeyedRequest & { readonly fingerprint: string; readonly now: DateTime.Utc }): Effect.Effect<RequestKeyClaim>;
    /** Keeps the answer of a claimed request. */
    complete(request: KeyedRequest & { readonly answer: RequestAnswer }): Effect.Effect<void>;
    /** Gives the key back after an unexpected failure, so sending the request again tries again. */
    release(request: KeyedRequest): Effect.Effect<void>;
  }
>()("@repo/invoicing/outbound/RequestKeys") {}

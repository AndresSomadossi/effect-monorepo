import { createHash, timingSafeEqual } from "node:crypto";
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";

import { Actor } from "@repo/invoicing";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** The access grants: each actor acting on behalf of the organization, with the secret token they present. */
export const AccessGrants = Schema.Record(Actor, Schema.RedactedFromValue(Schema.NonEmptyString));
export type AccessGrants = typeof AccessGrants.Type;

/**
 * Establishes whether a presented credential acts on behalf of the organization, and as whom. Shared by the endpoint (bearer token) and
 * the screen (session cookie), so both refuse exactly the same callers.
 */
export class OrganizationAccess extends Context.Service<
  OrganizationAccess,
  {
    actorFor(credential: Redacted.Redacted<string>): Effect.Effect<Option.Option<Actor>>;
  }
>()("@repo/billing/inbound/OrganizationAccess") {
  static readonly layer = (grants: AccessGrants): Layer.Layer<OrganizationAccess> => {
    const entries = Object.entries(grants).map(([actor, token]) => ({ actor: Actor.make(actor), token: digest(Redacted.value(token)) }));
    return Layer.succeed(
      OrganizationAccess,
      OrganizationAccess.of({
        // Compares digests in constant time, so a token cannot be guessed from how long a comparison takes.
        actorFor: (credential) =>
          Effect.sync(() => {
            const presented = digest(Redacted.value(credential));
            return Option.fromNullishOr(entries.find((entry) => timingSafeEqual(entry.token, presented))).pipe(Option.map((entry) => entry.actor));
          }),
      }),
    );
  };

  /** Grants read from `BILLING_ACCESS_TOKENS`, a JSON object of actor to token, such as `{"ops":"a-long-secret"}`. */
  static readonly layerConfig: Layer.Layer<OrganizationAccess, Config.ConfigError> = Layer.unwrap(Effect.map(Config.schema(Schema.fromJsonString(AccessGrants), "BILLING_ACCESS_TOKENS"), OrganizationAccess.layer));
}

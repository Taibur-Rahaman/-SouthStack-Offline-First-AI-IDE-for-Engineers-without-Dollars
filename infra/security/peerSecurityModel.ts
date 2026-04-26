/**
 * Gateway-facing security model: room isolation, lightweight tokens, validation hooks, chunk limits.
 */

export interface RoomCredential {
  readonly roomId: string;
  readonly peerId: string;
  readonly exp: number;
  readonly sig: string;
}

export interface GatewayValidationContext {
  readonly roomId: string;
  readonly peerId: string;
  readonly token: RoomCredential;
}

const MAX_CHUNK_BYTES_DEFAULT = 512 * 1024;

export interface ChunkPayloadPolicy {
  readonly maxChunkBytes: number;
}

export const DEFAULT_CHUNK_POLICY: ChunkPayloadPolicy = {
  maxChunkBytes: MAX_CHUNK_BYTES_DEFAULT,
};

/** Enforce room isolation: peer may only act inside credentialed room. */
export function assertRoomIsolation(ctx: GatewayValidationContext): boolean {
  return ctx.token.roomId === ctx.roomId && ctx.token.peerId === ctx.peerId;
}

/** Stub verification hook — bind to your JWT/HMAC verifier in gateway. */
export type TokenVerifier = (token: RoomCredential, nowSec: number) => boolean;

export function verifyLightweightToken(
  verify: TokenVerifier,
  token: RoomCredential,
  nowSec: number,
): boolean {
  if (token.exp <= nowSec) return false;
  return verify(token, nowSec);
}

/**
 * Gateway-side envelope check only — wire format validation stays in application `messageValidation`.
 * Use this for max size / rate limits before handing off to existing validators.
 */
export function gatewayEnvelopeAccepted(
  raw: Uint8Array,
  maxBytes: number,
): "ok" | "reject_oversize" | "reject_empty" {
  if (raw.byteLength === 0) return "reject_empty";
  if (raw.byteLength > maxBytes) return "reject_oversize";
  return "ok";
}

export function enforceChunkSize(
  raw: Uint8Array,
  policy: ChunkPayloadPolicy,
): "ok" | "reject_size" {
  if (raw.byteLength > policy.maxChunkBytes) return "reject_size";
  return "ok";
}

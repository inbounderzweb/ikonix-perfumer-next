/**
 * AUTH      – IP not whitelisted or credentials rejected: stop the run.
 * CONFIG    – wrong URL, customer or method: stop the run.
 * RATE      – provider asked us to slow down: stop the run and wait.
 * TRANSIENT – network, timeout, 5xx: retry later with backoff.
 * DATA      – the answer for this file/article cannot be read: counts against that item only.
 */
export type TrackingErrorKind = "AUTH" | "CONFIG" | "RATE" | "TRANSIENT" | "DATA";

/** Messages are written by this codebase and never include URLs, headers or credentials. */
export class TrackingError extends Error {
  constructor(readonly kind: TrackingErrorKind, message: string, readonly retryAfterSec?: number) { super(message); }
}
export const asTrackingError = (e: unknown) => (e instanceof TrackingError ? e : new TrackingError("TRANSIENT", "Unexpected error while talking to India Post."));

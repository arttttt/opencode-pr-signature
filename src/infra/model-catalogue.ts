/**
 * Fetches OpenRouter's public model catalogue behind an injectable fetch.
 *
 * The only network touch in the plugin. Stateless — TTL, backoff and the
 * cache belong to the registry; this adapter just performs one bounded
 * request and hands back parsed JSON for the domain to judge.
 */

const CATALOGUE_URL = "https://openrouter.ai/api/v1/models";
const REQUEST_TIMEOUT_MS = 5_000;
/** 16 MB — 20x today's payload; beyond this the response is not ours. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Bumped manually at release. Kept as a local constant: importing
 * ../package.json would leave src/ for a version string.
 */
const PLUGIN_VERSION = "1.1.0";

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

/** Read the body in chunks with a hard cap — never buffer unbounded first. */
async function readCapped(res: Response): Promise<string> {
  if (res.body === null) {
    // Degenerate path: no stream to cap mid-flight, so check after the fact.
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`catalogue response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    return text;
  }
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`catalogue response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Build the catalogue fetcher. Returns a function of the caller's abort
 * signal; the 5s timeout composes with it, so either can end the request.
 * Throws on non-2xx (with the status), oversized bodies, and any network
 * failure — the registry decides what that means for its schedule.
 */
export function createFetchCatalogue(
  fetchImpl: FetchImpl = (input, init) => globalThis.fetch(input, init),
): (signal: AbortSignal) => Promise<unknown> {
  return async (callerSignal: AbortSignal) => {
    const res = await fetchImpl(CATALOGUE_URL, {
      headers: {
        accept: "application/json",
        "user-agent": `opencode-pr-signature/${PLUGIN_VERSION}`,
      },
      signal: AbortSignal.any([callerSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!res.ok) {
      throw new Error(`catalogue request failed: HTTP ${res.status}`);
    }
    return JSON.parse(await readCapped(res));
  };
}

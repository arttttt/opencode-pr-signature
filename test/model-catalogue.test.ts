import { describe, expect, test } from "bun:test";
import { createFetchCatalogue } from "../src/infra/model-catalogue";

/**
 * Offline contract tests: the fetch implementation is always injected; the
 * suite never touches the network. Assertions cover the request shape
 * (URL, headers, signal pass-through) and every failure mode the caller
 * must distinguish.
 */

const CALLER_URL = "https://openrouter.ai/api/v1/models";

function responding(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

/** A Response whose stream yields the given chunks. */
function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("createFetchCatalogue", () => {
  test("ok + json resolves to the parsed body, with the documented request shape", async () => {
    let seenUrl: string | undefined;
    let seenInit: RequestInit | undefined;
    const fetchCatalogue = createFetchCatalogue(async (input, init) => {
      seenUrl = input;
      seenInit = init;
      return responding('{"data":[]}');
    });
    const controller = new AbortController();
    const body = await fetchCatalogue(controller.signal);
    expect(body).toEqual({ data: [] });
    expect(seenUrl).toBe(CALLER_URL);
    expect((seenInit!.headers as Record<string, string>).accept).toBe("application/json");
    expect((seenInit!.headers as Record<string, string>)["user-agent"]).toMatch(
      /^opencode-pr-signature\/\d+\.\d+\.\d+$/,
    );
    // The caller's signal is composed in, not discarded.
    expect(seenInit!.signal).toBeDefined();
    expect((seenInit!.signal as AbortSignal).aborted).toBe(false);
  });

  test("non-2xx throws carrying the status", async () => {
    const fetchCatalogue = createFetchCatalogue(async () => responding("nope", { status: 503 }));
    try {
      await fetchCatalogue(new AbortController().signal);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as Error).message).toContain("503");
    }
  });

  test("an HTML error page (200) rejects via JSON.parse", async () => {
    const fetchCatalogue = createFetchCatalogue(async () => responding("<html>blocked</html>"));
    await expect(fetchCatalogue(new AbortController().signal)).rejects.toThrow();
  });

  test("a body past the 16 MB cap rejects without buffering it all", async () => {
    // ~17 MB in 1 MB chunks; the cap must trip mid-stream, so this is fast.
    const megabyte = "a".repeat(1024 * 1024);
    const chunks = Array.from({ length: 17 }, () => megabyte);
    const fetchCatalogue = createFetchCatalogue(async () => chunkedResponse(chunks));
    await expect(fetchCatalogue(new AbortController().signal)).rejects.toThrow(/16 MB|bytes/);
  });

  test("a chunked body inside the cap reassembles correctly", async () => {
    const fetchCatalogue = createFetchCatalogue(async () =>
      chunkedResponse(['{"data":[', '{"id":"z-ai/glm-5.3"}', "]}"]),
    );
    await expect(fetchCatalogue(new AbortController().signal)).resolves.toEqual({
      data: [{ id: "z-ai/glm-5.3" }],
    });
  });

  test("caller abort propagates", async () => {
    const controller = new AbortController();
    const fetchCatalogue = createFetchCatalogue(async (_input, init) => {
      const signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("This operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const pending = fetchCatalogue(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });

  test("a network-level failure rejects as-is", async () => {
    const fetchCatalogue = createFetchCatalogue(async () => {
      throw new Error("fetch failed");
    });
    await expect(fetchCatalogue(new AbortController().signal)).rejects.toThrow("fetch failed");
  });
});

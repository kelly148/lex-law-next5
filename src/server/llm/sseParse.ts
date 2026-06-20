/**
 * Shared Server-Sent-Events line reader for the streaming adapters (F3 / DRAFT-STREAMING-1 Inc 3).
 *
 * Reads a fetch Response body (a ReadableStream of bytes) and yields each `data:` payload string, handling
 * UTF-8 chunk boundaries and partial trailing lines. Provider-agnostic TRANSPORT only — each adapter maps
 * the yielded JSON payloads to its own event shape. Reaches no provider (it consumes an already-opened
 * stream), so it sits outside the adapter chokepoint. The [DONE] sentinel (OpenAI/xAI) is yielded verbatim
 * for the caller to detect; Gemini's SSE has no sentinel (the stream simply ends).
 */
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl).replace(/\r$/, '');
        buffered = buffered.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0) continue;
        yield payload;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released on normal completion */
    }
  }
}

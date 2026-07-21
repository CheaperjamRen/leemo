// SSE test helpers for the gateway translation tests.
// Build OpenAI-shaped SSE ReadableStreams and parse Anthropic-shaped SSE output
// back into structured events for snapshot / ordering assertions.

/** Serialize one OpenAI item to its SSE wire form. */
function serializeItem(it: Record<string, any> | string): string {
  if (typeof it === "string") {
    if (it === "[DONE]") return "data: [DONE]\n\n";
    if (it.startsWith(":")) return `${it}\n\n`; // ping / comment line
    return `data: ${it}\n\n`;
  }
  return `data: ${JSON.stringify(it)}\n\n`;
}

/** Build a stream that delivers each OpenAI SSE event as its OWN network read —
 *  the realistic wire behavior (each `data: …\n\n` frame arrives separately).
 *  This matters: the vendor state machine breaks its inner loop on
 *  finish_reason, so a trailing usage-only frame is only observed if it lands in
 *  a later read. */
export function sseEventStream(
  items: Array<Record<string, any> | string>
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const frames = items.map((it) => enc.encode(serializeItem(it)));
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) controller.enqueue(frames[i++]);
      else controller.close();
    },
  });
}

/** Build a ReadableStream<Uint8Array> emitting the given raw SSE text as one or
 *  more byte-level reads. Splitting across arbitrary byte offsets exercises the
 *  vendor's line buffering (partial-line reassembly). */
export function rawSSEStream(
  raw: string,
  chunkSizes?: number[]
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = enc.encode(raw);
  const pieces: Uint8Array[] = [];
  if (chunkSizes && chunkSizes.length) {
    let off = 0;
    for (const n of chunkSizes) {
      pieces.push(bytes.slice(off, off + n));
      off += n;
    }
    if (off < bytes.length) pieces.push(bytes.slice(off));
  } else {
    pieces.push(bytes);
  }
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < pieces.length) {
        controller.enqueue(pieces[i++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Serialize OpenAI chunk objects (and control lines) into a single SSE body. */
export function openaiSSE(items: Array<Record<string, any> | string>): string {
  return items.map(serializeItem).join("");
}

/** Build a stream where each GROUP of OpenAI items is delivered as ONE network
 *  read (frames concatenated). This reproduces the live relay wire shape the B0
 *  diagnostic found: the trailing usage frame arrives in the SAME read as the
 *  finish_reason frame. The vendor's inner loop breaks on finish_reason and never
 *  reaches that co-arriving usage line — so real usage is dropped unless a
 *  first-party path recovers it. */
export function sseGroupedStream(
  groups: Array<Array<Record<string, any> | string>>
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const reads = groups.map((g) => enc.encode(g.map(serializeItem).join("")));
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < reads.length) controller.enqueue(reads[i++]);
      else controller.close();
    },
  });
}

/** Read a ReadableStream<Uint8Array> fully into a string. */
export async function collectStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

export interface SSEEvent {
  event: string;
  data: any;
}

/** Parse an Anthropic-style SSE body into ordered {event, data} pairs.
 *  Asserts nothing; callers assert on the returned sequence. */
export function parseAnthropicSSE(body: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = body.split("\n\n");
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let evName = "";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) evName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    let data: any = dataStr;
    try {
      data = JSON.parse(dataStr);
    } catch {
      /* leave as string ([DONE] etc.) */
    }
    events.push({ event: evName, data });
  }
  return events;
}

/** Just the ordered event-name sequence (for state-machine ordering asserts). */
export function eventNames(body: string): string[] {
  return parseAnthropicSSE(body).map((e) => e.event);
}

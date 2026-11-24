import { setTimeout as delay } from "node:timers/promises";

export interface FeedValidators {
  etag?: string;
  lastModified?: string;
}

type FeedResponse =
  | { status: 304; validators: FeedValidators }
  | { status: 200; xml: string; url: string; validators: FeedValidators };

const timeoutMs = 10_000;
const maxBodyBytes = 12 * 1024 * 1024;
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

async function readBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("Feed response body is empty.");
  if (Number(response.headers.get("content-length")) > maxBodyBytes) {
    await response.body.cancel();
    throw new Error("Feed exceeds the 12 MiB response limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw new Error("Feed exceeds the 12 MiB response limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

function textEncoding(bytes: Uint8Array, contentType: string): string {
  const [a, b, c, d] = bytes;
  if (a === 0xff && b === 0xfe) return "utf-16le";
  if (a === 0xfe && b === 0xff) return "utf-16be";
  if (a === 0xef && b === 0xbb && c === 0xbf) return "utf-8";
  if (a === 0x3c && b === 0 && c === 0x3f && d === 0) return "utf-16le";
  if (a === 0 && b === 0x3c && c === 0 && d === 0x3f) return "utf-16be";
  const declaration = new TextDecoder("ascii").decode(bytes.subarray(0, 256));
  return declaration.match(/^\s*<\?xml\s+[^>]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]
    ?? contentType.match(/\bcharset\s*=\s*["']?([^\s;"']+)/i)?.[1]
    ?? "utf-8";
}

function retryDelay(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter === null) return 450;
  const seconds = Number(retryAfter);
  const time = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  if (!Number.isFinite(time)) return 450;
  return time > 3_000 ? null : Math.max(450, time);
}

export async function fetchFeed(url: string, previous: FeedValidators = {}): Promise<FeedResponse> {
  const headers = new Headers({
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1",
    "User-Agent": "FinanceTechNewsReader/1.0",
  });
  if (previous.etag) headers.set("If-None-Match", previous.etag);
  if (previous.lastModified) headers.set("If-Modified-Since", previous.lastModified);

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt !== 0) throw error;
      await delay(450);
      continue;
    }

    const validators = {
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };

    if (response.status === 304) return { status: 304, validators };
    if (!response.ok) {
      await response.body?.cancel();
      const wait = retryableStatuses.has(response.status) ? retryDelay(response) : null;
      if (attempt === 0 && wait !== null) {
        await delay(wait);
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (/^(text\/html|application\/json)\b/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    const body = await readBody(response);
    const xml = new TextDecoder(textEncoding(body, contentType)).decode(body);
    return { status: 200, xml, url: response.url || url, validators };
  }
}

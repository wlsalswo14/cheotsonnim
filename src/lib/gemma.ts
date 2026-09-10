export interface GemmaPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GemmaResult<T> {
  value: T;
  ms: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  model: string;
}

export class GemmaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Gemma 4 on AI Studio ignores thinkingConfig, but a firm system instruction reliably
 * suppresses the thinking phase (measured: 0 thought tokens, ~6s per vision call).
 */
const NO_THINK_PREAMBLE = [
  "Do NOT think or reason step by step. Do not write any analysis, notes, or commentary.",
  "Output the final JSON object immediately as your first and only token sequence.",
  "The JSON must be valid: double-quoted keys and strings, no trailing commas, no comments, no markdown fences.",
].join(" ");

export const DEFAULT_MODEL = process.env.GEMMA_MODEL?.trim() || "gemma-4-26b-a4b-it";

/** Keys the API itself rejected (revoked, typo'd, wrong project) — skipped for this process. */
const rejectedKeys = new Set<string>();

function keyPool(): string[] {
  const list = (process.env.GEMMA_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const usable = list.filter((key) => !rejectedKeys.has(key));
  // If every key got retired the pool is probably wrong, not the keys: try them all again.
  return usable.length > 0 ? usable : list;
}

let cursor = Math.floor(Math.random() * 1000);

function pickKey(keys: string[], offset: number): string {
  return keys[(cursor + offset) % keys.length];
}

function extractJsonText(text: string): string {
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new GemmaError("model returned no JSON object");
  return body.slice(start, end + 1);
}

function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function parseJsonLoose<T>(text: string): T {
  const candidate = extractJsonText(text);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return JSON.parse(repairJson(candidate)) as T;
  }
}

interface GenerateOptions {
  system: string;
  parts: GemmaPart[];
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
  label?: string;
}

export async function generateJson<T>(options: GenerateOptions): Promise<GemmaResult<T>> {
  const keys = keyPool();
  if (keys.length === 0) throw new GemmaError("GEMMA_API_KEYS is not configured");
  const model = options.model ?? DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: `${NO_THINK_PREAMBLE}\n\n${options.system}` }] },
    contents: [{ role: "user", parts: options.parts }],
    generationConfig: {
      temperature: options.temperature ?? 0.25,
      responseMimeType: "application/json",
      maxOutputTokens: options.maxOutputTokens ?? 2048,
    },
  });
  const attempts = Math.max(3, keys.length);
  let lastError: GemmaError | undefined;
  const started = Date.now();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const key = pickKey(keys, attempt);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 75_000),
      });
    } catch (error) {
      lastError = new GemmaError(`network error: ${(error as Error).message}`);
      continue;
    }
    if (response.status === 429 || response.status === 503 || response.status === 500) {
      await response.body?.cancel().catch(() => undefined);
      lastError = new GemmaError(`model busy (${response.status})`, response.status);
      cursor += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      // One dead key in the pool used to kill the whole visit, because a 400 is not a
      // "busy" status and fell straight through to the throw. Retire it and try the next.
      if ([400, 401, 403].includes(response.status) && /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|expired/i.test(detail)) {
        rejectedKeys.add(key);
        console.warn(`gemma: retiring a rejected API key (${response.status}), ${keys.filter((entry) => !rejectedKeys.has(entry)).length} left`);
        lastError = new GemmaError(`api key rejected (${response.status})`, response.status);
        continue;
      }
      throw new GemmaError(`model request failed (${response.status}): ${detail}`, response.status);
    }
    const envelope = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const candidate = envelope.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
    if (!text) {
      lastError = new GemmaError(`model returned empty answer (finish=${candidate?.finishReason ?? "unknown"})`);
      continue;
    }
    let value: T;
    try {
      value = parseJsonLoose<T>(text);
    } catch (error) {
      lastError = new GemmaError(`model JSON parse failed: ${(error as Error).message}`);
      continue;
    }
    const usage = envelope.usageMetadata ?? {};
    return {
      value,
      ms: Date.now() - started,
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      thoughtTokens: usage.thoughtsTokenCount ?? 0,
      model,
    };
  }
  throw lastError ?? new GemmaError("model request failed");
}

export function imagePart(jpegBase64: string): GemmaPart {
  return { inlineData: { mimeType: "image/jpeg", data: jpegBase64 } };
}

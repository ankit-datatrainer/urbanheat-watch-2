import { PassThrough } from "node:stream";
import { z } from "zod";

// Streaming proxy for the in-app AI assistant. The OpenRouter key stays on the
// server; the app sends only the conversation and receives a slimmed SSE stream.

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter accepts at most 3 models per request, so routing is done in two
 * tiers: if every model in the first tier is rate-limited or unavailable before
 * any text is produced, the request is retried once on the second tier.
 */
export const MODEL_TIERS: string[][] = [
  ["nvidia/nemotron-3.5-lightning:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free"],
  ["google/gemma-4-26b-a4b-it:free", "thinkingmachines/inkling-small:free", "poolside/laguna-s-2.1:free"],
];

export const CHAT_SYSTEM_PROMPT =
  "You are UrbanHeat Watch AI, a research assistant inside the UrbanHeat Watch heat-safety app for students and families in Southeast Asia. " +
  "You specialise in heat stress (WBGT), weather, urban heat islands, climate and environmental health. " +
  'Write clear, accurate, well-structured answers in Markdown: use short "###" headings, bold key terms, and bullet points. ' +
  "Prefer concise answers (under 250 words) unless the user asks for depth. " +
  "Never use emojis. When a question involves medical risk, include when to seek emergency help.";

/** App languages and how the model is told to write in them. */
export const REPLY_LANGUAGES: Record<string, string> = {
  en: "English",
  ms: "Malay (Bahasa Melayu)",
  "zh-HK": "Traditional Chinese as used in Hong Kong",
  "zh-CN": "Simplified Chinese",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
};

/** The system prompt, with an instruction to answer in the user's chosen app language. */
export function systemPrompt(language?: string) {
  const name = language ? REPLY_LANGUAGES[language] : undefined;
  return name && language !== "en"
    ? `${CHAT_SYSTEM_PROMPT} Always reply in ${name}, whatever language the question is in. Keep units such as °C and WBGT unchanged.`
    : CHAT_SYSTEM_PROMPT;
}

/** Conversation turns the client may send. System prompts are server-owned, so "system" is rejected. */
export const chatBody = z.object({
  language: z.enum(Object.keys(REPLY_LANGUAGES) as [string, ...string[]]).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1]?.role === "user", "The last message must come from the user."),
});

export type ChatTurn = z.infer<typeof chatBody>["messages"][number];

export type ChatDeps = {
  apiKey: string;
  idleTimeoutMs: number;
  /**
   * Longest wait for the first piece of answer text from a model tier. OpenRouter sends keep-alive
   * comments while a model is queued or reasoning, which reset the idle timer, so without this a
   * stalled free model could hold the request open indefinitely instead of failing over.
   */
  firstTokenTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  tiers?: string[][];
};

type UpstreamError = { code: number; message: string };

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const KEEP_ALIVE_EVERY_MS = 10_000;

function friendly(code: number, raw: string): UpstreamError {
  if (code === 401 || code === 403) return { code: 401, message: "The AI service rejected the server's API key." };
  if (code === 402) return { code: 402, message: "The AI account has run out of credits." };
  if (code === 429)
    return { code: 429, message: "The free AI models are busy right now. Please try again in a moment." };
  return { code: code >= 400 ? code : 502, message: raw.slice(0, 200) || "The AI service is unavailable right now." };
}

function sse(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

/**
 * Streams one chat completion into `out` as SSE. Each event is either
 * `{"model", "choices":[{"delta":{"content"}}]}` or `{"error":{"code","message"}}`,
 * followed by `[DONE]`. Resolves when the stream is finished.
 */
export async function streamChat(
  messages: ChatTurn[],
  out: PassThrough,
  signal: AbortSignal,
  deps: ChatDeps,
  language?: string,
) {
  const doFetch = deps.fetchImpl ?? fetch;
  const tiers = deps.tiers ?? MODEL_TIERS;
  let lastError: UpstreamError = { code: 503, message: "The AI service is unavailable right now." };
  let lastKeepAlive = 0;

  const write = (chunk: string) => {
    if (!out.writableEnded) out.write(chunk);
  };

  try {
    for (const models of tiers) {
      if (signal.aborted) return;

      // Abort the upstream request if it goes quiet for too long or the client disconnects.
      const upstream = new AbortController();
      const onAbort = () => upstream.abort();
      signal.addEventListener("abort", onAbort);
      let idle: NodeJS.Timeout | undefined;
      const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => upstream.abort(new Error("idle timeout")), deps.idleTimeoutMs);
      };
      let firstToken: NodeJS.Timeout | undefined = setTimeout(
        () => upstream.abort(new Error("no content")),
        deps.firstTokenTimeoutMs ?? 20_000,
      );

      try {
        touch();
        let res: Response;
        try {
          res = await doFetch(OPENROUTER_CHAT_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${deps.apiKey}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "HTTP-Referer": "https://ecowatch.app",
              "X-Title": "EcoWatch",
            },
            body: JSON.stringify({
              models,
              messages: [{ role: "system", content: systemPrompt(language) }, ...messages.slice(-20)],
              stream: true,
              temperature: 0.6,
              reasoning: { exclude: true },
            }),
            signal: upstream.signal,
          });
        } catch {
          if (signal.aborted) return;
          lastError = { code: 504, message: "The AI service did not respond in time." };
          continue;
        }

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          let message = "";
          try {
            message = JSON.parse(text)?.error?.message ?? "";
          } catch {
            message = text;
          }
          lastError = friendly(res.status, message);
          if (RETRYABLE.has(res.status)) continue;
          write(sse({ error: lastError }));
          return;
        }

        let sentContent = false;
        let retryNextTier = false;
        let buffer = "";
        const decoder = new TextDecoder();
        const reader = res.body.getReader();

        const handleLine = (line: string): "stop" | void => {
          const trimmed = line.trim();
          if (trimmed.startsWith(":")) {
            // Relay OpenRouter's keep-alive comments (throttled) so proxies keep the connection open.
            if (Date.now() - lastKeepAlive >= KEEP_ALIVE_EVERY_MS) {
              lastKeepAlive = Date.now();
              write(": keep-alive\n\n");
            }
            return;
          }
          if (!trimmed.startsWith("data:")) return;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") return;
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          if (parsed.error) {
            const err = friendly(Number(parsed.error.code) || 502, String(parsed.error.message ?? ""));
            if (!sentContent && RETRYABLE.has(err.code)) {
              lastError = err;
              retryNextTier = true;
            } else {
              write(sse({ error: err }));
            }
            return "stop";
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            sentContent = true;
            clearTimeout(firstToken);
            firstToken = undefined;
            write(sse({ model: parsed.model, choices: [{ delta: { content } }] }));
          }
        };

        let stopped = false;
        try {
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            touch();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (handleLine(line) === "stop") {
                stopped = true;
                break;
              }
            }
          }
          if (!stopped && buffer) handleLine(buffer);
        } catch {
          if (signal.aborted) return;
          if (!sentContent) {
            lastError = { code: 504, message: "The AI service stopped responding." };
            continue;
          }
          write(sse({ error: { code: 504, message: "The connection to the AI service dropped." } }));
          return;
        } finally {
          reader.cancel().catch(() => {});
        }

        if (retryNextTier) continue;
        if (!sentContent && !stopped) {
          lastError = { code: 502, message: "The AI model returned an empty answer. Please try again." };
          continue;
        }
        return;
      } finally {
        clearTimeout(idle);
        clearTimeout(firstToken);
        signal.removeEventListener("abort", onAbort);
      }
    }

    write(sse({ error: lastError }));
  } finally {
    write(sse("[DONE]"));
    out.end();
  }
}

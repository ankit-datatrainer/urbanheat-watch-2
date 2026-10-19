import { fetch as expoFetch } from 'expo/fetch';
import { API_BASE_URL } from './api';
import { tx } from './i18n';

// Client for the EcoWatch AI assistant. Requests go to the EcoWatch backend
// (backend/api, POST /api/v1/ai/chat), which holds the OpenRouter key and model
// routing; no AI credentials are bundled into the app.

export const ASSISTANT_NAME = 'UrbanHeat Watch AI';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
}

export type AIErrorKind = 'not_configured' | 'auth' | 'credits' | 'rate_limit' | 'network' | 'aborted' | 'unknown';

export class AIError extends Error {
  kind: AIErrorKind;
  constructor(kind: AIErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type AIStatus = 'ready' | 'not_configured' | 'offline';

const OFFLINE_MESSAGE = tx('Could not reach the UrbanHeat Watch server. Check your connection and try again.');

/** Asks the backend whether the assistant is available. */
export async function checkAIStatus(): Promise<AIStatus> {
  try {
    const res = await expoFetch(`${API_BASE_URL}/api/v1/ai/status`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'offline';
    const body = await res.json();
    return body?.configured ? 'ready' : 'not_configured';
  } catch {
    return 'offline';
  }
}

/** Short display name for a model id, e.g. "nvidia/nemotron-3.5-lightning:free" -> "Nemotron 3.5 Lightning". */
export function formatModelName(modelId?: string): string {
  if (!modelId) return '';
  const base = modelId.split('/').pop()?.replace(/:free$/, '') ?? modelId;
  return base
    .split('-')
    .filter((part) => !/^a\d+b$/i.test(part) && part.toLowerCase() !== 'it')
    .map((part) => (/^\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function errorFromCode(code: number, message: string): AIError {
  if (code === 401 || code === 403) return new AIError('auth', message || tx('The AI service rejected the server key.'));
  if (code === 402) return new AIError('credits', message || tx('The AI account has run out of credits.'));
  if (code === 429) return new AIError('rate_limit', message || tx('The AI is busy right now. Please try again in a moment.'));
  return new AIError('unknown', message || tx('The AI service is unavailable right now.'));
}

interface StreamOptions {
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** App language code; the server tells the model to answer in it. */
  language?: string;
  signal?: AbortSignal;
  onDelta?: (accumulated: string, model?: string) => void;
}

/**
 * Streams a reply from the EcoWatch backend. Calls `onDelta` with the growing
 * answer and resolves with the final text and the model that produced it.
 */
export async function streamChatCompletion(opts: StreamOptions): Promise<{ content: string; model?: string }> {
  let response;
  try {
    response = await expoFetch(`${API_BASE_URL}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: opts.messages.slice(-20), language: opts.language }),
      signal: opts.signal,
    });
  } catch {
    if (opts.signal?.aborted) throw new AIError('aborted', tx('Response stopped.'));
    throw new AIError('network', OFFLINE_MESSAGE);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 503 && body?.error === 'ai_not_configured') {
      throw new AIError('not_configured', tx('The AI assistant is not configured on the UrbanHeat Watch server yet.'));
    }
    if (response.status === 429) {
      throw new AIError('rate_limit', tx("You're sending messages quickly. Please wait a minute and try again."));
    }
    throw errorFromCode(response.status, body?.message ?? '');
  }

  let accumulated = '';
  let model: string | undefined;
  let buffer = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    // Lines starting with ":" are SSE keep-alive comments.
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed.error) {
      throw errorFromCode(Number(parsed.error.code) || 500, parsed.error.message ?? '');
    }
    if (parsed.model) model = parsed.model;
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      accumulated += delta;
      opts.onDelta?.(accumulated, model);
    }
  };

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Only parse complete lines; keep the trailing partial line for the next chunk.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
    } catch (err) {
      // An error event after some text keeps the partial answer instead of discarding it.
      if (err instanceof AIError) {
        if (accumulated) return { content: accumulated.trim(), model };
        throw err;
      }
      if (accumulated) return { content: accumulated.trim(), model };
      if (opts.signal?.aborted) throw new AIError('aborted', tx('Response stopped.'));
      throw new AIError('network', tx('The connection dropped while the answer was streaming.'));
    }
    buffer.split('\n').forEach(handleLine);
  } else {
    (await response.text()).split('\n').forEach(handleLine);
  }

  if (!accumulated.trim()) {
    throw new AIError('unknown', tx('The AI returned an empty answer. Please try again.'));
  }
  return { content: accumulated.trim(), model };
}

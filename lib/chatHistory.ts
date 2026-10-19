import { supabase } from './supabase';
import type { ChatMessage } from './aiChat';

const HISTORY_LIMIT = 100;

/**
 * AI chat history is stored in the `ai_messages` table (see supabase/schema.sql).
 * Every call fails soft: if the table has not been created yet or the network is
 * down, the assistant keeps working and only persistence is skipped.
 */
export async function loadChatHistory(): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, model, created_at')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error || !data) {
    if (error) console.warn('Could not load AI chat history:', error.message);
    return [];
  }

  return data.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model ?? undefined,
    timestamp: new Date(row.created_at).getTime(),
  }));
}

export async function saveChatMessage(userId: string, message: ChatMessage): Promise<void> {
  const { error } = await supabase.from('ai_messages').insert({
    user_id: userId,
    role: message.role,
    content: message.content,
    model: message.model ?? null,
  });
  if (error) console.warn('Could not save AI message:', error.message);
}

export async function clearChatHistory(userId: string): Promise<void> {
  const { error } = await supabase.from('ai_messages').delete().eq('user_id', userId);
  if (error) console.warn('Could not clear AI chat history:', error.message);
}

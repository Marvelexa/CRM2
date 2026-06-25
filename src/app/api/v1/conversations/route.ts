import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { data: conversations, error } = await ctx.supabase
      .from('conversations')
      .select('id, status, assigned_agent_id, last_message_text, last_message_at, unread_count, created_at, updated_at, contact:contacts(id, name, phone, email)')
      .eq('account_id', ctx.accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(`Failed to list conversations: ${error.message}`);
    }

    return ok(conversations || []);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

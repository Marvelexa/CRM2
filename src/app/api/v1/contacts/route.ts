import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const offsetParam = parseInt(searchParams.get('offset') || '0', 10);
    const phoneFilter = searchParams.get('phone');
    const emailFilter = searchParams.get('email');

    const limit = isNaN(limitParam) ? 50 : Math.min(100, Math.max(1, limitParam));
    const offset = isNaN(offsetParam) ? 0 : Math.max(0, offsetParam);

    let query = ctx.supabase
      .from('contacts')
      .select('id, name, phone, email, company, avatar_url, created_at, updated_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (phoneFilter) {
      const sanitized = sanitizePhoneForMeta(phoneFilter);
      query = query.like('phone', `%${sanitized}`);
    }

    if (emailFilter) {
      query = query.ilike('email', `%${emailFilter}%`);
    }

    const { data: contacts, error } = await query;
    if (error) {
      throw new Error(`Failed to list contacts: ${error.message}`);
    }

    return ok(contacts || []);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = await request.json();
    const { phone, name, email, company } = body;

    if (!phone) {
      return toApiErrorResponse(badRequest('phone is required'));
    }

    // Sanitize and validate phone
    const normalizedPhone = sanitizePhoneForMeta(phone);
    if (!isValidE164(normalizedPhone)) {
      return toApiErrorResponse(badRequest('Invalid phone number format'));
    }

    // Check for existing contact
    const existing = await findExistingContact(ctx.supabase, ctx.accountId, normalizedPhone);
    if (existing) {
      return toApiErrorResponse(badRequest('Contact with this phone number already exists'));
    }

    // Resolve owner user_id
    let userId = ctx.createdBy;
    if (!userId) {
      const { data: p } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', ctx.accountId)
        .limit(1)
        .maybeSingle();
      userId = p?.user_id || null;
    }
    if (!userId) {
      return toApiErrorResponse(badRequest('No active user found linked to this account.'));
    }

    const { data: contact, error } = await ctx.supabase
      .from('contacts')
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        phone: normalizedPhone,
        name: name?.trim() || null,
        email: email?.trim() || null,
        company: company?.trim() || null,
      })
      .select('id, name, phone, email, company, avatar_url, created_at, updated_at')
      .single();

    if (error || !contact) {
      throw new Error(`Failed to create contact: ${error?.message}`);
    }

    return ok(contact);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

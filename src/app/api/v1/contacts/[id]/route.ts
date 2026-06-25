import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;

    const { data: contact, error } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone, email, company, avatar_url, created_at, updated_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch contact: ${error.message}`);
    }

    if (!contact) {
      throw notFound('Contact not found');
    }

    return ok(contact);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;

    // Check if contact exists
    const { data: existingContact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existingContact) {
      throw notFound('Contact not found');
    }

    const body = await request.json();
    const { name, phone, email, company } = body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) {
      updateData.name = name?.trim() || null;
    }

    if (phone !== undefined) {
      const normalizedPhone = sanitizePhoneForMeta(phone);
      if (!isValidE164(normalizedPhone)) {
        return toApiErrorResponse(badRequest('Invalid phone number format'));
      }

      // Check if another contact already has this phone number
      const duplicate = await findExistingContact(ctx.supabase, ctx.accountId, normalizedPhone);
      if (duplicate && duplicate.id !== id) {
        return toApiErrorResponse(badRequest('Another contact already has this phone number'));
      }
      updateData.phone = normalizedPhone;
    }

    if (email !== undefined) {
      updateData.email = email?.trim() || null;
    }

    if (company !== undefined) {
      updateData.company = company?.trim() || null;
    }

    const { data: updatedContact, error } = await ctx.supabase
      .from('contacts')
      .update(updateData)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, name, phone, email, company, avatar_url, created_at, updated_at')
      .single();

    if (error || !updatedContact) {
      throw new Error(`Failed to update contact: ${error?.message}`);
    }

    return ok(updatedContact);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

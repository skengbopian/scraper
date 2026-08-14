'use server';

import { revalidatePath } from 'next/cache';
import { readRegister } from '@/lib/register';
import {
  assignInboundDocument,
  discardOpsEscalation,
  resolveOpsRequest,
  sendOpsEscalation,
  type OpsResolution,
} from '@/lib/api';

/**
 * Server actions for the review queue (port wave 5, ADR-037).
 *
 * These are plain `<form>` posts, like the register switches, so the screen works before hydration
 * and with JS disabled. That matters more here than on a consumer page: an ops reviewer working
 * through a queue on a bad connection must not have a button that silently does nothing.
 *
 * None of them decides anything. Every one forwards to an API route behind `OpsRoleGuard`, and the
 * state machine — not this file — refuses an illegal transition, an escalation with no proven
 * receipt, or a re-send whose guards no longer pass.
 */

const RESOLUTIONS: readonly OpsResolution[] = ['complied', 'incomplete', 'refused', 'resend', 'escalate'];

/**
 * WHY EVERY ACTION RETURNS A MESSAGE (audit W7, ops half).
 *
 * These used to return `void` and drop the `ApiResult` on the floor. The API answers a refused
 * transition precisely — STALE_STATE because another reviewer moved the ticket first, GUARD_MANDATE
 * because the mandate was revoked mid-flight, provenReceipt because nothing establishes the
 * controller ever received the request — and every one of those sentences was thrown away, leaving a
 * button that appeared to do something and did nothing. A reviewer's only feedback was the row not
 * changing, which is indistinguishable from a slow page.
 *
 * The consumer side was fixed first (the request screen surfaces the API's answer under the button);
 * the same rule applies here, and the project rule it comes from is blunt: no screen dead-ends.
 * The message is already in the caller's register — the API answers in it (ADR-034) — so returning
 * it is the whole fix.
 *
 * Signature note: `(prev, formData)` is the `useFormState` shape, which is why the forms in
 * queue-row/inbox-row are client components. A plain `action={fn}` cannot render a result.
 */
export async function resolveCase(_prev: string | null, formData: FormData): Promise<string | null> {
  const id = String(formData.get('id') ?? '');
  const resolution = String(formData.get('resolution') ?? '');
  if (!id || !RESOLUTIONS.includes(resolution as OpsResolution)) return null;
  const result = await resolveOpsRequest(id, resolution as OpsResolution, readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/ops');
  return null;
}

/**
 * File the drafted Art. 77 complaint.
 *
 * The action's name says what it records rather than what it achieves: a HUMAN files the complaint
 * with the authority, and this marks that they did. Nothing here sends anything to a DPA.
 */
export async function fileComplaint(_prev: string | null, formData: FormData): Promise<string | null> {
  const id = String(formData.get('id') ?? '');
  if (!id) return null;
  const result = await sendOpsEscalation(id, readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/ops');
  return null;
}

export async function discardComplaint(_prev: string | null, formData: FormData): Promise<string | null> {
  const id = String(formData.get('id') ?? '');
  if (!id) return null;
  const result = await discardOpsEscalation(id, readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/ops');
  return null;
}

/** Correlate a document to a case. The case id is the reviewer's, never the document's. */
export async function assignDocument(_prev: string | null, formData: FormData): Promise<string | null> {
  const documentId = String(formData.get('documentId') ?? '');
  const requestId = String(formData.get('requestId') ?? '').trim();
  if (!documentId || !requestId) return null;
  const result = await assignInboundDocument(documentId, requestId, readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/ops');
  return null;
}

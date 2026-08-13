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

export async function resolveCase(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const resolution = String(formData.get('resolution') ?? '');
  if (!id || !RESOLUTIONS.includes(resolution as OpsResolution)) return;
  await resolveOpsRequest(id, resolution as OpsResolution, readRegister());
  revalidatePath('/ops');
}

/**
 * File the drafted Art. 77 complaint.
 *
 * The action's name says what it records rather than what it achieves: a HUMAN files the complaint
 * with the authority, and this marks that they did. Nothing here sends anything to a DPA.
 */
export async function fileComplaint(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await sendOpsEscalation(id, readRegister());
  revalidatePath('/ops');
}

export async function discardComplaint(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await discardOpsEscalation(id, readRegister());
  revalidatePath('/ops');
}

/** Correlate a document to a case. The case id is the reviewer's, never the document's. */
export async function assignDocument(formData: FormData): Promise<void> {
  const documentId = String(formData.get('documentId') ?? '');
  const requestId = String(formData.get('requestId') ?? '').trim();
  if (!documentId || !requestId) return;
  await assignInboundDocument(documentId, requestId, readRegister());
  revalidatePath('/ops');
}

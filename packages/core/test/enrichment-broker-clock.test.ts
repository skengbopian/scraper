import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { registeredResendChannel, type Playbook } from '../src/index.js';

/**
 * CONTRACT (docs/10 §7, ADR-024, OQ-21) — the enrichment-broker playbooks have NO provable silence clock.
 *
 * These target US/UK brokers reachable only by email/web_form; there is no German Einwurf-Einschreiben
 * path, so `registeredResendChannel` is null. That means the worker MUST NOT offer a registered re-send
 * on `AWAITING_REGISTERED_RESEND` for these — it must route to a terminal NO_PROVABLE_CLOCK, never call
 * planDispatch(forceRegistered), which throws when no registered channel exists (apps/worker provenance
 * workflow). This test locks the precondition so a future channel change can't silently reintroduce the
 * dead-end. Escalation on SILENCE is therefore off (onDeadlineExpiry: NONE); escalation on a REFUSAL —
 * which is itself proof of receipt — stays on (onRefusal: DRAFT_ART77, invariant 3b).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (slug: string): Playbook =>
  YAML.parse(fs.readFileSync(path.join(ROOT, 'playbooks', `${slug}.yaml`), 'utf8')) as Playbook;

const BROKER_PLAYBOOKS = [
  'loeschung.zoominfo',
  'loeschung.apollo',
  'loeschung.lusha',
  'loeschung.cognism',
  'loeschung.peopledatalabs',
  'loeschung.rocketreach',
  'loeschung.generic-datenhaendler',
];

describe('enrichment-broker playbooks have no provable silence clock (OQ-21 contract)', () => {
  for (const slug of BROKER_PLAYBOOKS) {
    it(`${slug}: registeredResendChannel is null, so silence escalation is off and refusal escalation is on`, () => {
      const pb = load(slug);
      expect(registeredResendChannel(pb), 'no registered channel → worker must route to NO_PROVABLE_CLOCK, not force a resend').toBeNull();
      expect(pb.escalation?.onDeadlineExpiry).toBe('NONE');
      expect(pb.escalation?.onRefusal).toBe('DRAFT_ART77');
    });
  }
});

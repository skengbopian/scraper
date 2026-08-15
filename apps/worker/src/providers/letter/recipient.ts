import type { PostalRecipient } from '@scraper/core';

/**
 * A playbook's postal recipient is one comma-joined string, and it has to become address LINES.
 *
 *   "AZ Direct GmbH, Datenschutz, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh"
 *     → AZ Direct GmbH / Datenschutz / Carl-Bertelsmann-Str. 161S / 33311 Gütersloh
 *
 * PARSED, NOT RESTRUCTURED. The obvious alternative is to change the playbook schema to a structured
 * recipient — and it is not available: every shipped playbook is frozen at its `(slug, version)` by
 * migration 0005's `playbook_freeze` and by the version seal, and the recipient string is playbook
 * content that only counsel may restate (PLAN §7). So the flat string stays authoritative and the
 * structure is derived from it here, at the one place that needs it.
 *
 * It REFUSES what it cannot lay out. A letter whose address field is wrong is a letter that comes
 * back or never arrives, and either way the request looks like controller silence: a burned month
 * and a false non-compliance statistic. Failing to the human queue is much cheaper than that.
 */

export class UnparseableRecipientError extends Error {
  constructor(recipient: string, why: string) {
    super(`postal recipient ${JSON.stringify(recipient)} cannot be laid out in a DIN 5008 address field: ${why}`);
    this.name = 'UnparseableRecipientError';
  }
}

/**
 * DIN 5008 Form B gives the Anschriftzone six lines. Four are in use here (name, department,
 * street, place); six is the hard ceiling and a recipient needing more has to be shortened by a
 * human rather than silently truncated into a wrong address.
 */
const MAX_ADDRESS_LINES = 6;
/** The Anschriftfeld is 85 mm wide. At 11 pt Helvetica that is comfortably under 50 characters. */
const MAX_LINE_LENGTH = 50;

/** `33311 Gütersloh`, or a Postfach line's own `50474 Köln`. Germany-first, per docs/07. */
const GERMAN_PLACE_LINE = /^\d{5}\s+\S/;

export function parsePostalRecipient(recipient: string): PostalRecipient {
  const lines = recipient
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new UnparseableRecipientError(recipient, 'fewer than two address lines — a name and a place are the minimum');
  }
  if (lines.length > MAX_ADDRESS_LINES) {
    throw new UnparseableRecipientError(recipient, `${lines.length} address lines; DIN 5008 allows ${MAX_ADDRESS_LINES}`);
  }
  const tooLong = lines.find((l) => l.length > MAX_LINE_LENGTH);
  if (tooLong !== undefined) {
    throw new UnparseableRecipientError(recipient, `the line ${JSON.stringify(tooLong)} does not fit the 85 mm address field`);
  }

  // The place line must be LAST. Anything else means the string was assembled in an order this
  // parser would misread — and an address whose Postleitzahl is not on the final line is one a
  // sorting machine reads wrong.
  const placeIndex = lines.findIndex((l) => GERMAN_PLACE_LINE.test(l));
  if (placeIndex === -1) {
    throw new UnparseableRecipientError(recipient, 'no "PLZ Ort" line — a five-digit postal code followed by a place name');
  }
  if (placeIndex !== lines.length - 1) {
    throw new UnparseableRecipientError(
      recipient,
      `the "PLZ Ort" line (${JSON.stringify(lines[placeIndex])}) is not last; a German address ends with it`,
    );
  }

  return { lines, country: 'DE' };
}

/** True when this playbook recipient can be posted at all — used to route to the human queue early. */
export function isLayoutablePostalRecipient(recipient: string): boolean {
  try {
    parsePostalRecipient(recipient);
    return true;
  } catch {
    return false;
  }
}

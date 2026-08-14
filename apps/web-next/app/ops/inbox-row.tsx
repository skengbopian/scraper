import type { AppStrings } from '@scraper/i18n';
import type { InboundDocumentView } from '@/lib/types';
import { OpsActionForm } from './action-form';
import { assignDocument } from './actions';

/**
 * One document in the inbox.
 *
 * `senderRef` and `subjectLine` are rendered exactly as they arrived, and that is the point: they
 * are a CORRELATION HINT for the person reading them, not an instruction. A reply that quotes our
 * reference helps a reviewer find the case; it does not select one. The case id is typed by the
 * reviewer, so a document asserting "this answers request req_X" cannot close a stranger's
 * statutory request (docs/04 Phase-0, CLAUDE.md §2). React escapes both by default.
 */
export function InboxRow({ doc, s }: { doc: InboundDocumentView; s: AppStrings }) {
  return (
    <li className="row" style={{ display: 'block', padding: '12px 0' }}>
      <b>
        <span>{doc.senderRef}</span>
        <span className={`tag ${doc.assignedRequestId ? 'good' : 'warn'}`}>
          {doc.assignedRequestId ? s.ops.inboxAssigned : s.ops.inboxUnassigned}
        </span>
      </b>
      {doc.subjectLine ? <small>{doc.subjectLine}</small> : null}
      <small>
        <time dateTime={doc.receivedAt}>{doc.receivedAt.slice(0, 10)}</time> · {doc.channel}
      </small>
      {doc.assignedRequestId ? null : (
        <OpsActionForm action={assignDocument} fields={{ documentId: doc.id }} label={s.ops.inboxAssigned}>
          <label>
            <span className="sr-only">{s.ops.inboxHeading}</span>
            {/* A mistyped case id now says ALREADY_ASSIGNED or "request not found" instead of
                silently doing nothing — which, on a screen whose whole job is correlating a document
                to the RIGHT case, was the worst possible failure to hide. */}
            <input name="requestId" type="text" required autoComplete="off" />
          </label>
        </OpsActionForm>
      )}
    </li>
  );
}

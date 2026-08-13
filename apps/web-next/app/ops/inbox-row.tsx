import type { AppStrings } from '@scraper/i18n';
import type { InboundDocumentView } from '@/lib/types';
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
        <form action={assignDocument} className="btnrow">
          <input type="hidden" name="documentId" value={doc.id} />
          <label>
            <span className="sr-only">{s.ops.inboxHeading}</span>
            <input name="requestId" type="text" required autoComplete="off" />
          </label>
          <button className="btn" type="submit">{s.ops.inboxAssigned}</button>
        </form>
      )}
    </li>
  );
}

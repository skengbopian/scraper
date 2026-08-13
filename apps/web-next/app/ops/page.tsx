import { getOpsInbox, getOpsQueue } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { ApiError } from '../api-error';
import { InboxRow } from './inbox-row';
import { QueueRow } from './queue-row';

export const dynamic = 'force-dynamic';

/**
 * The internal review queue — the screen wave 2c deliberately refused to build.
 *
 * 2c's reasoning is worth keeping next to the result: the pre-audit line had an ops screen, this API
 * had no ops endpoints, and shipping the screen would have been a mock-up of a capability the
 * product did not have. Wave 5 built the endpoints first (`apps/api/src/ops`), behind a role stored
 * on the User row rather than asserted by a request header, and only then this page.
 *
 * Everything a reviewer can do here is a form post to a route the state machine guards. The page
 * decides nothing: it cannot escalate a case with no proven receipt, it cannot re-send one whose
 * mandate was revoked, and the single button that reaches ESCALATED does so as a HUMAN_OPS actor
 * because there is no other kind of actor that edge accepts (ADR-008).
 */
export default async function OpsPage() {
  const s = strings();
  const register = readRegister();
  const [queue, inbox] = await Promise.all([getOpsQueue(register), getOpsInbox(register)]);

  // An ordinary signed-in user lands here as a 403 with reason OPS_ROLE_REQUIRED, which ApiError
  // renders as "restricted to the review team" — not as an identity prompt, which would be a
  // resolving action for a problem they do not have.
  if (!queue.ok) return <ApiError status={queue.status} message={queue.message} reason={queue.reason} s={s} />;

  return (
    <>
      <p className="eyebrow">{s.ops.eyebrow}</p>
      <h1>{s.ops.heading}</h1>
      <p className="sub">{s.ops.sub}</p>

      <h2>{s.ops.queueHeading}</h2>
      {queue.data.length === 0 ? (
        <p className="sub">{s.ops.queueEmpty}</p>
      ) : (
        <ul className="list">
          {queue.data.map((item) => (
            <QueueRow item={item} s={s} key={item.id} />
          ))}
        </ul>
      )}

      <h2>{s.ops.inboxHeading}</h2>
      {!inbox.ok || inbox.data.length === 0 ? (
        <p className="sub">{s.ops.inboxEmpty}</p>
      ) : (
        <ul className="list">
          {inbox.data.map((doc) => (
            <InboxRow doc={doc} s={s} key={doc.id} />
          ))}
        </ul>
      )}
    </>
  );
}

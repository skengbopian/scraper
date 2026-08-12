import { notFound } from 'next/navigation';
import { getRequest } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { resolveDeadline } from '@/lib/clock';
import { DeadlineCard } from '../../deadline-card';
import { ResendChoice } from './resend-choice';

export const dynamic = 'force-dynamic';

/** Which pipeline step a state sits at (docs/09 §3: progress you can see, never a raw code). */
const STEP: Record<string, { done: number; active: number }> = {
  READY: { done: -1, active: 0 },
  SENT: { done: 0, active: 1 },
  AWAITING_RESPONSE_PROVISIONAL: { done: 0, active: 1 },
  AWAITING_RESPONSE: { done: 0, active: 1 },
  AWAITING_REGISTERED_RESEND: { done: 0, active: 1 },
  RESPONSE_RECEIVED: { done: 1, active: 2 },
  NEEDS_HUMAN: { done: 1, active: 2 },
  INCOMPLETE: { done: 1, active: 2 },
  REFUSED: { done: 1, active: 2 },
  ESCALATION_DRAFTED: { done: 2, active: 3 },
  ESCALATED: { done: 2, active: 3 },
  COMPLIED: { done: 3, active: -1 },
  CLOSED_FAILED: { done: -1, active: -1 },
  WITHDRAWN: { done: -1, active: -1 },
  DRAFT: { done: -1, active: 0 },
  BLOCKED_IDENTITY: { done: -1, active: 0 },
};

export default async function CasePage({ params }: { params: { id: string } }) {
  const s = strings();
  const result = await getRequest(params.id, readRegister());
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p className="err">{s.errors.offline}</p>;
  }
  const request = result.data;
  // Throws loudly if the API ever sends a statutory deadline without a provable send — see clock.ts.
  const deadline = resolveDeadline(request);
  const step = STEP[request.state] ?? { done: -1, active: -1 };
  const labels = [s.case.stepSent, s.case.stepDeadline, s.case.stepReply, s.case.stepDone];

  return (
    <>
      <p className="eyebrow">{s.case.eyebrow}</p>
      <h1>{s.requestTypeLabel[request.requestType]}</h1>
      <p className="sub">{s.stateLabel[request.state]}</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pipe">
          {labels.map((label, i) => (
            <div key={label} className={`step ${i <= step.done ? 'done' : i === step.active ? 'active' : ''}`}>
              <div className="bub" aria-hidden="true">{i + 1}</div>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <DeadlineCard deadline={deadline} s={s} now={new Date()} />
      </div>

      {request.state === 'AWAITING_REGISTERED_RESEND' && (
        <>
          <p className="sub" style={{ marginTop: 16 }}>{s.clock.silenceNote}</p>
          <ResendChoice id={request.id} confirmLabel={s.clock.registeredCta} declineLabel={s.clock.declineCta} />
        </>
      )}
    </>
  );
}

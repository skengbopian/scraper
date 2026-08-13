import { strings } from '@/lib/register';
import { isSafeNextPath } from '@/lib/session';
import { StepUpForm } from './step-up-form';

export const dynamic = 'force-dynamic';

/**
 * Step-up (docs/06 C2): re-confirm the second factor before high-sensitivity content is released.
 *
 * Deliberately NOT part of the sign-in flow and deliberately not worded as one. The user is already
 * signed in; copy that said "anmelden" here would read as a session that had silently expired, and
 * the honest thing to explain is why we are asking again — which is what `stepUp.why` does.
 */
export default function StepUpPage({ searchParams }: { searchParams: { next?: string } }) {
  const s = strings();
  // Same-origin paths only. The server action validates this again before redirecting; an open
  // redirect on the screen that has just asked for a one-time code would be a phishing gift.
  const requested = searchParams.next ?? '';
  const next = isSafeNextPath(requested) ? requested : '/akte';

  return (
    <>
      <h1>{s.stepUp.heading}</h1>
      <p className="sub">{s.stepUp.sub}</p>
      <div className="callout">
        <p>{s.stepUp.why}</p>
      </div>
      <StepUpForm
        next={next}
        labels={{ code: s.auth.totpCode, submit: s.stepUp.cta, note: s.stepUp.expiresNote }}
      />
    </>
  );
}

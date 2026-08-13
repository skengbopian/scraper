import { signOut, verifyIdentity } from '../auth-actions';

/** Plain forms, so both actions work without JavaScript. */
export function AccountActions({ labels, showVerify }: { labels: { verify: string; signOut: string }; showVerify: boolean }) {
  return (
    <div className="btnrow">
      {showVerify && (
        <form action={verifyIdentity}>
          <button type="submit" className="btn primary">{labels.verify}</button>
        </form>
      )}
      <form action={signOut}>
        <button type="submit" className="btn ghost">{labels.signOut}</button>
      </form>
    </div>
  );
}

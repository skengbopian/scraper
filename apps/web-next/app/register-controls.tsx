import type { Register } from '@scraper/i18n';
import { setLanguage, toggleReadingLevel } from './actions';

/**
 * The two register switches, as plain forms.
 *
 * Deliberately NOT client components with onClick handlers: a form posting to a server action works
 * with JavaScript disabled, on a flaky mobile connection, and before hydration finishes. The users
 * docs/09 names — low digital confidence, mid-range Android — are exactly the ones who meet a page
 * whose JS has not arrived yet, and a language switch that silently does nothing is worse than a
 * full page load.
 */
export function RegisterControls({
  register,
  plainLabel,
  switchLabel,
}: {
  register: Register;
  plainLabel: string;
  switchLabel: string;
}) {
  const plain = register === 'de-leicht';
  return (
    <div className="chips">
      <form action={toggleReadingLevel}>
        <button type="submit" className="chip" aria-pressed={plain}>
          {plainLabel}
        </button>
      </form>
      <form action={register === 'en' ? setLanguageDe : setLanguageEn}>
        <button type="submit" className="chip">
          {switchLabel}
        </button>
      </form>
    </div>
  );
}

// Server actions bound at module scope: `action={fn.bind(null, arg)}` would also work, but naming
// the two directions keeps the toggle readable and avoids passing an argument through the form.
async function setLanguageEn(): Promise<void> {
  'use server';
  await setLanguage('en');
}
async function setLanguageDe(): Promise<void> {
  'use server';
  await setLanguage('de');
}

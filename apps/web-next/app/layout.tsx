import type { ReactNode } from 'react';
import { languageOf } from '@scraper/i18n';
import { readRegister, strings } from '@/lib/register';
import { RegisterControls } from './register-controls';
import { Trowel } from './trowel';
import './globals.css';

export const metadata = { title: 'Scraper – Wer hat Ihre Daten?' };

/**
 * The app shell. `lang` follows the LANGUAGE, not the register: Leichte Sprache is German, and
 * telling a screen reader otherwise would change its pronunciation (ADR-034).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  const register = readRegister();
  const s = strings();
  return (
    <html lang={languageOf(register)}>
      <body>
        <div className="app">
          <header className="bar">
            <div className="brand">
              <Trowel />
              <span>
                <b>{s.brand.name}</b>
                <small>{s.brand.subtitle}</small>
              </span>
            </div>
            <RegisterControls register={register} plainLabel={s.nav.plainLanguage} switchLabel={s.nav.switchLocale} />
          </header>
          <main>{children}</main>
          <nav className="tabs" aria-label={s.brand.name}>
            <a href="/">{s.nav.start}</a>
            <a href="/firmen">{s.nav.firms}</a>
            <a href="/vorgaenge">{s.nav.cases}</a>
          </nav>
        </div>
      </body>
    </html>
  );
}

import type { CensusController } from '@/lib/types';

/**
 * Category colours for the glyph tile. These are the design system's INK values, not its base
 * Ampel colours, and are fixed rather than theme-dependent: the tile always carries white text, so
 * the background must clear 4.5:1 against white in BOTH themes. The base amber (#B26A00) is ~4.0:1
 * and failed the axe gate — #8A5410 is the same hue at ~6.3:1.
 */
const TYPE_COLOUR: Record<string, string> = {
  'Datenhändler': '#A3201B',
  'Adress-Broker': '#8A5410',
  'Auskunftei': '#59189E',
  'KI-Bewerbungstool': '#4A4363',
};

/** A company in a list. The initials are a placeholder glyph — never a third-party logo (ADR-030). */
export function CompanyRow({ controller }: { controller: CensusController }) {
  const tone = controller.risk === 'crit' ? 'crit' : controller.risk === 'warn' ? 'warn' : 'mut';
  return (
    <a className="row" href={`/firmen/${controller.slug}`}>
      <span className="glyph" style={{ background: TYPE_COLOUR[controller.type] ?? '#5A6570' }} aria-hidden="true">
        {controller.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="txt">
        <b>
          <span>{controller.name}</span>
          <span className={`tag ${tone}`}>{controller.riskLbl}</span>
        </b>
        <small>{controller.holds}</small>
      </span>
    </a>
  );
}

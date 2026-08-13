import type { PostalAddress } from '../identity/subject.js';

/**
 * A deliberately tiny Handlebars-subset renderer: `{{var}}`, `{{#if flag}}…{{/if}}`,
 * `{{#each list}}…{{this}}…{{/each}}`. Nothing else.
 *
 * Why not a real template engine: these templates produce legal correspondence. A general engine
 * brings helpers, partials and expression evaluation — surface area that could let a value from a
 * controller's reply influence what the next letter says. The renderer takes a closed record of
 * values derived from the verified identity and emits text. That is all it can do.
 *
 * It also FAILS on an unresolved variable rather than emitting an empty string. A letter that goes
 * out with a blank "Name:" line gets rejected for failure to identify, burns the one-month clock, and
 * books a false non-compliance statistic against the controller.
 */

export class UnresolvedTemplateVariableError extends Error {
  constructor(public readonly variable: string, public readonly template: string) {
    super(
      `Template "${template}" references {{${variable}}} but no value was supplied. Refusing to render: ` +
        `an empty field in a legal letter gets the request rejected for failure to identify.`,
    );
    this.name = 'UnresolvedTemplateVariableError';
  }
}

export type RenderValue =
  | string
  | number
  | boolean
  | Date
  | PostalAddress
  | readonly PostalAddress[]
  // Request-scoped label lists (the Art. 17(1)(d) category list). Only ever produced by
  // `deriveErasureScope`, which sanitises every element before it can reach this renderer.
  | readonly string[]
  | undefined;

export function formatGermanDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

export function formatAddress(a: PostalAddress): string {
  return `${a.street}, ${a.postalCode} ${a.city}${a.country && a.country !== 'DE' ? `, ${a.country}` : ''}`;
}

function stringify(v: RenderValue, variable: string, templateName: string): string {
  if (v === undefined || v === null) throw new UnresolvedTemplateVariableError(variable, templateName);
  if (v instanceof Date) return formatGermanDate(v);
  if (typeof v === 'object' && 'street' in v) return formatAddress(v as PostalAddress);
  return String(v);
}

/** Strip the HTML comment header — it is documentation for engineers, not part of the letter. */
export function stripDocComment(body: string): string {
  return body.replace(/<!--[\s\S]*?-->\s*/g, '');
}

export interface RenderInput {
  readonly templateName: string;
  readonly body: string;
  readonly values: Readonly<Record<string, RenderValue>>;
  /** Boolean switches for {{#if}} blocks: playbook templateFlags + engine-derived flags. */
  readonly flags: Readonly<Record<string, boolean>>;
}

export function render(input: RenderInput): string {
  let out = stripDocComment(input.body);

  // {{#each list}} … {{this}} … {{/each}}
  out = out.replace(/\{\{#each\s+([A-Za-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, name: string, inner: string) => {
    const list = input.values[name];
    // An UNSUPPLIED list used to render as nothing, which made this the one construct that could fail
    // silently — the file header's whole argument ("fails on an unresolved variable rather than
    // emitting an empty string") was implemented for {{var}} and not for {{#each}}. The letter that
    // exposed it announces "Löschung ausschließlich der folgenden Datenkategorien" and then lists
    // none: an unbounded erasure demand at a credit bureau, arriving with no error anywhere.
    // An EMPTY array still renders nothing — that is a real answer ("no former addresses"), and it is
    // the caller stating it rather than the renderer assuming it.
    if (list === undefined) throw new UnresolvedTemplateVariableError(name, input.templateName);
    if (!Array.isArray(list)) throw new Error(`{{#each ${name}}} expected an array`);
    return list
      .map((item) => inner.replace(/\{\{\s*this\s*\}\}/g, stringify(item as RenderValue, `${name}.this`, input.templateName)))
      .join('');
  });

  // {{#if flag}} … {{/if}} — an undeclared flag is FALSE, so the branch is omitted. That is the
  // correct default for identityProofEnclosed: no packet attached => no enclosure sentence.
  out = out.replace(/\{\{#if\s+([A-Za-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, name: string, inner: string) =>
    input.flags[name] === true ? inner : '',
  );

  // {{var}}
  out = out.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name: string) =>
    stringify(input.values[name], name, input.templateName),
  );

  const leftover = out.match(/\{\{[^}]*\}\}/);
  if (leftover) {
    throw new Error(`Template "${input.templateName}" still contains an unrendered construct: ${leftover[0]}`);
  }
  return out.trimStart();
}

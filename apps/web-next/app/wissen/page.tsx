import { strings } from '@/lib/register';

export const dynamic = 'force-dynamic';

/** The jargon list (docs/09 §4): every legal term one tap from a one-sentence explanation. */
export default function LearnPage() {
  const s = strings();
  const terms = [s.glossary.bureau, s.glossary.broker, s.glossary.objection, s.glossary.erasure, s.glossary.score, s.glossary.origin];
  return (
    <>
      <p className="eyebrow">{s.learn.eyebrow}</p>
      <h1>{s.learn.heading}</h1>
      <p className="sub">{s.learn.sub}</p>
      <div className="list" style={{ marginTop: 16 }}>
        {terms.map(([term, explanation]) => (
          <details className="card" key={term}>
            <summary><strong>{term}</strong></summary>
            <p style={{ fontSize: 14.5, marginTop: 8 }}>{explanation}</p>
          </details>
        ))}
      </div>
    </>
  );
}

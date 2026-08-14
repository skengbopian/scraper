-- 0014 — AWAITING_DELIVERY_PROOF: the state that makes the Art. 12(3) clock reachable (audit F3a).
--
-- Einlieferung is not Zustellung. Once the LetterXpress adapter was made honest (it had been
-- stamping `origin: 'CARRIER'` and `deliveredAt: now()` onto a mere lodgement — audit F3b), every
-- real registered send returned `proof: null` and degraded to the PROVISIONAL clock. The graph had
-- no upgrade edge, so in production the statutory clock was unreachable: the one thing the whole
-- two-clock machinery exists to produce could not be produced.
--
-- The fix is a state, not an edge. An "upgrade" edge on AWAITING_RESPONSE_PROVISIONAL was rejected
-- because email sends live in that state too, so the edge would have to be gated by a runtime check
-- — and invariant 4a (silence can never escalate on a provisional clock) would stop being a
-- property of the graph and become an `if` someone can relax. See schema/request-state-machine.md.
--
-- This migration adds ONLY the enum value. The column and its CHECK live in 0015 because Postgres
-- refuses to USE a new enum value in the transaction that added it, and the CHECK names it.

ALTER TYPE "RequestState" ADD VALUE 'AWAITING_DELIVERY_PROOF';

import { Controller, Get } from '@nestjs/common';
import { devFixturesEnabled, DEV_DEMO_PLAYBOOK_PAIRS } from '../common/dev-fixtures.js';
import { CENSUS, datenanfragenRecord } from './census.js';
import { ENRICHMENT_BROKER_ROUTES } from '@scraper/core';

/**
 * The public census: which controllers the product knows, what they hold, and which instrument the
 * UI files by default. No identity guard — this is product data, not user data; the web renders the
 * company list from it before any auth exists.
 *
 * `expectedOutcome` is a UI hint ONLY (the honest three-way answer the engine will give today);
 * the authoritative decision is always POST /requests → planRequestCreation.
 */
@Controller('controllers')
export class CensusController {
  @Get()
  list() {
    const demoPairs = devFixturesEnabled() ? DEV_DEMO_PLAYBOOK_PAIRS : [];
    return CENSUS.map((c) => {
      const route = ENRICHMENT_BROKER_ROUTES.find((r) => r.companySlug === c.slug);
      const legalDemo = demoPairs.some((p) => p.controllerSlug === c.slug && p.requestType === c.defaultRequestType);
      const community = datenanfragenRecord(c.slug);
      return {
        slug: c.slug,
        id: c.id,
        name: c.name,
        type: c.type,
        risk: c.risk,
        riskLbl: c.riskLbl,
        holds: c.holds,
        defaultRequestType: c.defaultRequestType,
        featured: c.featured,
        expectedOutcome: route ? ('SELF_SERVE' as const) : legalDemo ? ('LEGAL' as const) : ('NONE' as const),
        // The Tier-1 route's guided steps, so the decision screen renders them WITHOUT creating a
        // request. The POST happens only when the user acts (it records the LeverageAction).
        selfServe: route ? { url: route.url, steps: route.steps, requiresLogin: route.requiresLogin === true } : null,
        // CC0 community record (datenanfragen.de) — provenance retained, counsel re-verifies before
        // any real send; surfaced so the UI can show sourced contact channels.
        community: community
          ? { email: community.email ?? null, fax: community.fax ?? null, quality: community.quality ?? null, sources: community.sources }
          : null,
      };
    });
  }
}

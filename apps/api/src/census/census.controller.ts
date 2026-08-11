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
    const selfServeSlugs = new Set(ENRICHMENT_BROKER_ROUTES.map((r) => r.companySlug));
    const demoPairs = devFixturesEnabled() ? DEV_DEMO_PLAYBOOK_PAIRS : [];
    return CENSUS.map((c) => {
      const selfServe = selfServeSlugs.has(c.slug);
      const legalDemo = demoPairs.some((p) => p.controllerSlug === c.slug && p.requestType === c.defaultRequestType);
      const community = datenanfragenRecord(c.slug);
      return {
        slug: c.slug,
        name: c.name,
        type: c.type,
        risk: c.risk,
        riskLbl: c.riskLbl,
        holds: c.holds,
        defaultRequestType: c.defaultRequestType,
        featured: c.featured,
        expectedOutcome: selfServe ? ('SELF_SERVE' as const) : legalDemo ? ('LEGAL' as const) : ('NONE' as const),
        // CC0 community record (datenanfragen.de) — provenance retained, counsel re-verifies before
        // any real send; surfaced so the UI can show sourced contact channels.
        community: community
          ? { email: community.email ?? null, fax: community.fax ?? null, quality: community.quality ?? null, sources: community.sources }
          : null,
      };
    });
  }
}

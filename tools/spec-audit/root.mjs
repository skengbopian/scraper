// Repo root, derived rather than hardcoded so the harness runs in CI, in a container, and in any
// checkout path. Override with SCRAPER_ROOT when running from somewhere unusual.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.SCRAPER_ROOT
  ? path.resolve(process.env.SCRAPER_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

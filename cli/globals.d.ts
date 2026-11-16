// For TypeScript's check of the CLI's JavaScript (tsconfig.cli.json); nothing here is shipped or run.
// window.census is what the capture script puts in the page, typed from src/browser.ts, so a
// page.evaluate(() => window.census.…) call is checked against the real API.
import type { CensusApi } from "../src/browser";

declare global {
  interface Window { census: CensusApi }
}
export {};

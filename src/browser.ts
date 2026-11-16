// The script a capture puts in the page: window.census, with no other effect on the page.
import { censusLines, forceDone, forceMark, forceRead, layoutLines, mergeCensus, styleData, type Census, type StyleRules } from "./census";

const at = (sel?: string) => (sel ? document.querySelector(sel) ?? document.body : document.body);
const api = {
  data: (rules: StyleRules, sel?: string) => styleData(rules, at(sel)),
  lines: (c: Census) => censusLines(c),
  merge: (pages: Record<string, Census>) => mergeCensus(pages),
  layout: () => layoutLines(),
  // for a capture that forces states through the DevTools Protocol
  forceMark, forceRead, forceDone,
};
(window as unknown as { census: typeof api }).census = api;

/** What window.census is in a captured page: the CLI's page.evaluate calls are checked against it (cli/globals.d.ts). */
export type CensusApi = typeof api;

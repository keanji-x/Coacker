/**
 * Test the new DOM parser against the live panel
 * Usage: cd ~/Coacker && npx tsx packages/cli/tests/test-parser.ts
 */

import { Antigravity } from '../../backend/src/ag/client.js';
import { parsePanel, countTurns, getResponseSince, getLastResponse } from '../../backend/src/ag/parser.js';
import { loadConfig, getBackendConfig } from '@coacker/shared';
import { writeFileSync } from 'node:fs';

async function main() {
  const cfg = loadConfig();
  const backendCfg = getBackendConfig(cfg);

  const ag = new Antigravity({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: false,
  });

  const title = await ag.connect(backendCfg.ag?.windowTitle);
  console.log('Connected:', title);
  const page = ag.page;

  // 1. parsePanel
  const turns = await parsePanel(page);
  console.log(`\nTotal turns: ${turns.length}`);
  for (const t of turns) {
    const blocksSummary = t.blocks.map(b => `${b.type}:${b.content.length}c`).join(', ');
    console.log(`  [${t.index}] ${t.role} — ${blocksSummary}`);
  }

  // 2. countTurns
  const turnCount = await countTurns(page);
  console.log(`\ncountTurns: ${turnCount}`);

  // 3. getLastResponse
  const lastResp = await getLastResponse(page);
  console.log(`getLastResponse: ${lastResp.length} chars`);
  console.log(`  preview: ${lastResp.slice(0, 120).replace(/\n/g, '\\n')}`);

  // 4. getResponseSince (from turn 0 = everything)
  const allResp = await getResponseSince(page, 0);
  console.log(`\ngetResponseSince(0): ${allResp.length} chars`);

  // 5. getResponseSince (from last 2 turns)
  const recent = await getResponseSince(page, Math.max(0, turnCount - 2));
  console.log(`getResponseSince(${Math.max(0, turnCount - 2)}): ${recent.length} chars`);

  writeFileSync('/tmp/parser-output.json', JSON.stringify(turns, null, 2));
  console.log('\nFull output → /tmp/parser-output.json');

  await ag.disconnect();
  console.log('Done!');
}

main().catch(console.error);

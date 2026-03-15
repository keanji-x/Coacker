/**
 * E2E: Audit Pipeline — 审查代码
 *
 * 执行: cd /Users/jianxie/Desktop/Coacker && npx tsx packages/cli/tests/e2e-audit.test.ts
 */

import { AgBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
import {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from '@coacker/brain';
import { Player } from '@coacker/player';

async function main() {
  console.log('=== E2E: Audit Pipeline ===\n');

  const backend = new AgBackend({
    endpointUrl: 'http://localhost:9222',
    humanize: true,
  });

  const player = new Player({
    backend,
    taskTimeout: 300,
    rolePrompts: {
      intention: INTENTION_SYSTEM_PROMPT.replace('{{MAX_TASKS}}', '3'),
      implementer: IMPLEMENTATION_SYSTEM_PROMPT,
      reviewer: REVIEWER_SYSTEM_PROMPT,
      attacker: ATTACKER_SYSTEM_PROMPT,
      gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
      consolidator: CONSOLIDATION_SYSTEM_PROMPT,
    },
  });

  const brain = new Brain({
    project: {
      root: '.',
      entry: 'packages/brain/src/index.ts',
      intent: 'Review the @coacker TypeScript monorepo: brain, player, backend, shared packages.',
    },
    audit: {
      maxGapRounds: 1,
      maxSubTasks: 3,
    },
    output: {
      dir: './output',
    },
  });

  console.log('Connecting to IDE...');
  const title = await player.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  try {
    console.log('Running audit...\n');
    const report = await brain.run(player);

    console.log('\n' + '='.repeat(60));
    console.log(`Tasks analyzed: ${report.tasks.length}`);
    for (const t of report.tasks) {
      console.log(`  [${t.taskId}] ${t.intention.slice(0, 60)}`);
    }

    if (report.executiveSummary) {
      console.log('\n--- Executive Summary ---');
      console.log(report.executiveSummary);
    }

    console.log('\n📁 All results saved to: ./output');

  } finally {
    await player.disconnect();
    console.log('\nDisconnected.');
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

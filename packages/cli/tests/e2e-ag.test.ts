/**
 * E2E 测试: AgBackend — 复杂任务
 *
 * 让 IDE 里的 AI 分析当前项目的 packages/shared 模块，
 * 输出模块描述。验证完整的 Brain → Player → Backend 闭环。
 *
 * 执行: cd /Users/jianxie/Desktop/Coacker && npx tsx packages/cli/tests/e2e-ag.test.ts
 */

import { AgBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
import {
  IMPLEMENTATION_SYSTEM_PROMPT,
} from '@coacker/brain';
import { Player } from '@coacker/player';

async function main() {
  console.log('=== E2E Test: Complex Task (Analyze Module) ===\n');

  // 1. 创建 Backend + Player + Brain
  const backend = new AgBackend({
    endpointUrl: 'http://localhost:9222',
    humanize: true,
  });

  const player = new Player({
    backend,
    taskTimeout: 120,
    rolePrompts: {
      implementer: IMPLEMENTATION_SYSTEM_PROMPT,
    },
  });

  // 直接用 Player 执行一个单步 task (不走 Brain audit 流程)
  console.log('Connecting to IDE...');
  const title = await player.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  try {
    const task = {
      id: 'analyze_shared',
      intention: 'Analyze the @coacker/shared module structure',
      type: 'implement' as const,
      steps: [{
        id: 'analyze',
        role: 'implementer',
        message: [
          '## Task: analyze_shared',
          '**Intention:** Analyze the @coacker/shared module structure',
          '**Entry File:** packages/shared/src/index.ts',
          '',
          'Read packages/shared/src/types.ts and packages/shared/src/config.ts.',
          'For each file, describe its purpose in 1-2 sentences.',
          'List the main exported types/functions.',
          'Output as a Markdown summary.',
        ].join('\n'),
      }],
    };

    console.log('Running task (will take ~30-60s)...\n');
    const result = await player.executeTask(task);

    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));

    const icon = result.status === 'success' ? '✅' : '❌';
    console.log(`\n${icon} ${result.taskId} (${result.type}) — ${result.elapsed.toFixed(1)}s`);

    for (const sr of result.stepResults) {
      console.log(`  Step ${sr.stepId}: ${sr.status} (${sr.elapsed.toFixed(1)}s)`);
      console.log(`  Snapshot (first 500 chars):`);
      console.log(`  ${sr.snapshot.slice(0, 500)}`);
    }

    // 断言
    console.log('\n--- Assertions ---');
    const ok = (cond: boolean, msg: string) => {
      if (cond) console.log(`  ✅ ${msg}`);
      else { console.log(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
    };

    ok(result.status === 'success', `Status: ${result.status}`);
    ok(result.stepResults.length === 1, `Steps: ${result.stepResults.length}`);
    ok(result.stepResults[0]?.snapshot.length > 50, `Snapshot length: ${result.stepResults[0]?.snapshot.length} chars`);

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

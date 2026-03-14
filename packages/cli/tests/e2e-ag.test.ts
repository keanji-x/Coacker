/**
 * E2E 测试: AgBackend — 复杂任务
 *
 * 让 IDE 里的 AI 分析当前项目的 packages/shared 模块，
 * 输出模块描述。验证完整的 Brain → Player → Backend 闭环。
 *
 * 执行: cd ts && npx tsx packages/cli/tests/e2e-ag.test.ts
 */

import { AgBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
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
  });

  const brain = new Brain({
    knowledgeDir: '/tmp/coacker-e2e-knowledge',
    audit: { maxGapRounds: 0 },
  });

  // 2. 连接 Coacker 窗口
  console.log('Connecting to IDE...');
  const title = await player.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  try {
    // 3. 创建复杂任务: 分析 shared 模块
    brain.dispatcher.createTask('implement', [
      'Read packages/shared/src/types.ts and packages/shared/src/config.ts.',
      'For each file, describe its purpose in 1-2 sentences.',
      'List the main exported types/functions.',
      'Output as a Markdown summary.',
    ].join(' '), {
      id: 'analyze_shared',
      context: {
        userIntent: 'Analyze the @coacker/shared module structure',
        projectRoot: '/Users/jianxie/Desktop/Coacker',
        entryFile: 'packages/shared/src/index.ts',
      },
    });

    console.log(`📋 ${brain.dispatcher.summary()}\n`);

    // 4. 运行
    console.log('Running task (will take ~30-60s)...\n');
    const results = await brain.run(player);

    // 5. 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));

    for (const r of results) {
      const icon = r.status === 'success' ? '✅' : '❌';
      console.log(`\n${icon} ${r.taskId} (${r.type}) — ${r.elapsed.toFixed(1)}s`);
      console.log(`Steps: ${r.steps}, Approvals: ${r.approvals}`);
      console.log('\n--- Response (first 500 chars) ---');
      console.log(r.response.slice(0, 500));
      if (r.response.length > 500) console.log(`... [${r.response.length - 500} more chars]`);
    }

    // 6. 知识库
    console.log('\n--- Knowledge Base ---');
    console.log(`${brain.knowledge.size} entries:`);
    for (const entry of brain.knowledge.all()) {
      console.log(`  📚 ${entry.title}`);
      console.log(`     Tags: [${entry.tags.join(', ')}]`);
      console.log(`     Content: ${entry.content.slice(0, 100)}...`);
    }

    // 7. 断言
    console.log('\n--- Assertions ---');
    const ok = (cond: boolean, msg: string) => {
      if (cond) console.log(`  ✅ ${msg}`);
      else { console.log(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
    };

    ok(results.length === 1, `Got ${results.length} result(s)`);
    ok(results[0]?.status === 'success', `Status: ${results[0]?.status}`);
    ok(results[0]?.response.length > 50, `Response length: ${results[0]?.response.length} chars`);
    ok(brain.knowledge.size === 1, `Knowledge entries: ${brain.knowledge.size}`);

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

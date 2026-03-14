/**
 * E2E: AuditPipeline — 审查 ts/ 代码
 *
 * 用 AuditPipeline 审查 /Users/jianxie/Desktop/Coacker/ts 路径。
 * 连接真实 IDE，走完整 Intention → Implement → Gap → Review+Attack 流程。
 *
 * 执行: cd ts && npx tsx packages/cli/tests/e2e-audit.test.ts
 */

import { AgBackend } from '@coacker/backend';
import { AuditPipeline } from '@coacker/brain';
import { Player } from '@coacker/player';
import { writeFileSync } from 'node:fs';

async function main() {
  console.log('=== E2E: Audit Pipeline ===\n');

  // 1. 创建 Backend + Player
  const backend = new AgBackend({
    endpointUrl: 'http://localhost:9222',
    humanize: true,
  });

  const player = new Player({
    backend,
    taskTimeout: 300, // 5 分钟每个任务
  });

  // 2. 创建 AuditPipeline
  const pipeline = new AuditPipeline({
    audit: { maxGapRounds: 1 },  // 只做 1 轮 gap 分析，省时间
    events: {
      onTaskStart: (task) => {
        console.log(`\n⏳ Starting: ${task.id} (${task.type})`);
      },
      onTaskDone: (task, result) => {
        const icon = result.status === 'success' ? '✅' : '❌';
        console.log(`${icon} Done: ${task.id} — ${result.elapsed.toFixed(1)}s`);
      },
    },
  });

  // 3. 连接
  console.log('Connecting to IDE...');
  const title = await player.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  try {
    // 4. 运行审查
    console.log('Running audit pipeline on ts/ ...\n');
    const report = await pipeline.run(
      player,
      'packages/brain/src/index.ts',
      'Review the @coacker TypeScript monorepo: brain, player, backend, shared packages. Focus on architecture, type safety, and error handling.',
    );

    // 5. 输出
    console.log('\n' + '='.repeat(60));
    console.log('AUDIT REPORT');
    console.log('='.repeat(60));

    console.log(`\nTasks analyzed: ${report.tasks.length}`);
    console.log(report.summary);

    for (const t of report.tasks) {
      console.log(`\n--- [${t.taskId}] ${t.intention.slice(0, 60)} ---`);
      console.log(`  Implementation: ${t.implementation.length} chars`);
      console.log(`  Review: ${t.codeReview.length} chars`);
      console.log(`  Attack: ${t.attackReview.length} chars`);
    }

    // 6. 保存完整 Markdown 报告
    const md = report.toMarkdown();
    const outPath = '/tmp/coacker-audit-report.md';
    writeFileSync(outPath, md, 'utf-8');
    console.log(`\n📄 Full report saved to: ${outPath} (${md.length} chars)`);

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

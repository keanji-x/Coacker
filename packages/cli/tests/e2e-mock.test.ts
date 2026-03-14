/**
 * E2E 测试: MockBackend 验证全流程
 *
 * 测试 Brain → Player → MockBackend 的完整闭环:
 *   1. Brain 创建任务
 *   2. Player 构建 prompt + 发送给 Backend
 *   3. Backend 返回 mock 回复
 *   4. Player 收集结果
 *   5. Brain 归纳知识
 *
 * 执行: cd ts && npx tsx packages/cli/tests/e2e-mock.test.ts
 */

import { MockBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
import { Player } from '@coacker/player';

async function main() {
  console.log('=== E2E Test: MockBackend ===\n');

  // 1. 创建 MockBackend (预设回复)
  const backend = new MockBackend([
    {
      response: `## Intention Analysis

I analyzed the project structure. Here are the review tasks:

[
  {"id": "config_review", "intention": "Review configuration loading and validation"},
  {"id": "backend_review", "intention": "Review Backend interface and implementations"}
]`,
      state: 'done',
      delay: 50,
    },
  ]);

  // 2. 创建 Player
  const player = new Player({
    backend,
    skillsDir: '/tmp/nonexistent-skills', // 没有 skills, 没关系
    taskTimeout: 60,
  });

  // 3. 创建 Brain
  const brain = new Brain({
    knowledgeDir: '/tmp/coacker-test-knowledge',
    audit: { maxGapRounds: 0 }, // 不做 gap 分析
  });

  // 4. 连接
  const title = await player.connect();
  console.log(`✅ Connected to: ${title}`);

  // 5. 创建初始任务
  brain.dispatcher.createTask('intention', 'Review the Coacker project structure', {
    id: 'intention',
    context: {
      userIntent: 'Review the Coacker project structure',
      projectRoot: '/Users/jianxie/Desktop/Coacker',
    },
  });

  console.log(`📋 Tasks: ${brain.dispatcher.summary()}`);

  // 6. 运行
  const results = await brain.run(player);

  // 7. 验证结果
  console.log('\n--- Results ---');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : '❌';
    console.log(`${icon} ${r.taskId} (${r.type}) — ${r.elapsed.toFixed(1)}s`);
    console.log(`   Response preview: ${r.response.slice(0, 100)}...`);
  }

  // 8. 验证 MockBackend 记录
  console.log('\n--- MockBackend Stats ---');
  console.log(`Conversations created: ${backend.conversationCount}`);
  console.log(`Chat calls: ${backend.chatHistory.length}`);
  for (const [i, call] of backend.chatHistory.entries()) {
    console.log(`\n  Call #${i}: ${call.message.slice(0, 80)}...`);
  }

  // 9. 验证知识库
  console.log(`\n--- Knowledge ---`);
  console.log(`Entries: ${brain.knowledge.size}`);
  for (const entry of brain.knowledge.all()) {
    console.log(`  📚 ${entry.title} [${entry.tags.join(', ')}]`);
  }

  // 10. 断开
  await player.disconnect();

  // 断言
  const ok = (cond: boolean, msg: string) => {
    if (cond) console.log(`  ✅ ${msg}`);
    else { console.log(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
  };

  console.log('\n--- Assertions ---');
  ok(results.length === 1, `Got ${results.length} results (expected 1)`);
  ok(results[0]?.status === 'success', `Status: ${results[0]?.status}`);
  ok(backend.conversationCount === 1, `Conversations: ${backend.conversationCount}`);
  ok(backend.chatHistory.length === 1, `Chat calls: ${backend.chatHistory.length}`);
  ok(brain.knowledge.size === 1, `Knowledge entries: ${brain.knowledge.size}`);
  ok(
    backend.chatHistory[0]?.message.includes('intention'),
    'Prompt contains task intention',
  );

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

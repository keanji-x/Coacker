/**
 * E2E Debug: 对话切换 — 在每一步 dump panel snapshot 到文件
 *
 * 执行: cd ts && npx tsx packages/cli/tests/e2e-switch-debug.test.ts
 *
 * 产出: /tmp/switch_debug/ 目录下一系列带编号的 snapshot 文件
 */

import { AgBackend } from '@coacker/backend';
// 直接从源文件导入底层 panel 函数
import { snapshotPanel, diffSnapshots } from '../../backend/src/ag/panel.js';
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = '/tmp/switch_debug';
let stepCounter = 0;

/** 把内容写到 /tmp/switch_debug/NNN_label.txt */
function dump(label: string, content: string) {
  stepCounter++;
  const filename = `${String(stepCounter).padStart(3, '0')}_${label}.txt`;
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`  📄 Dumped: ${filename} (${content.length} chars)`);
}

async function main() {
  // 清理输出目录
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`=== Debug: Panel Snapshots → ${OUT_DIR} ===\n`);

  const backend = new AgBackend({
    endpointUrl: 'http://localhost:9222',
    humanize: true,
  });

  console.log('Connecting...');
  const title = await backend.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  // 获取底层 page 对象，用来调 snapshotPanel
  const page = backend.raw.page;

  try {
    // ─────────────────────────────────────────────
    // STEP 0: 初始面板状态
    // ─────────────────────────────────────────────
    console.log('--- STEP 0: Initial panel state ---');
    const snap0 = await snapshotPanel(page);
    dump('initial_panel', snap0);

    // ─────────────────────────────────────────────
    // STEP 1: 新建 Conv A
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 1: New conversation A ---');
    await backend.newConversation();
    const snap1 = await snapshotPanel(page);
    dump('after_new_conv_a', snap1);

    // ─────────────────────────────────────────────
    // STEP 2: Conv A — 发消息前拍 before snapshot
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 2: Conv A — before snapshot (this is what chat() will use as before) ---');
    const convA_before = await snapshotPanel(page);
    dump('conv_a_before_chat', convA_before);

    // ─────────────────────────────────────────────
    // STEP 3: Conv A — chat
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 3: Conv A — sending message ---');
    const msgA = 'We are playing a game. The secret word is ALBATROSS. Remember it. Reply "OK" if you understand.';
    const resA = await backend.chat(msgA);
    console.log(`🤖 Conv A response: "${resA.response}"`);
    dump('conv_a_chat_response', resA.response);
    dump('conv_a_chat_fullPanel', resA.fullPanel || '(empty)');

    // chat 后再独立拍一次
    const convA_after = await snapshotPanel(page);
    dump('conv_a_after_chat_panel', convA_after);

    // 手动 diff 验证
    const manualDiffA = diffSnapshots(convA_before, convA_after, msgA);
    dump('conv_a_manual_diff', manualDiffA);

    // ─────────────────────────────────────────────
    // STEP 4: 新建 Conv B
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 4: New conversation B ---');
    await backend.newConversation();
    const snap4 = await snapshotPanel(page);
    dump('after_new_conv_b', snap4);

    // ─────────────────────────────────────────────
    // STEP 5: Conv B — before snapshot
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 5: Conv B — before snapshot ---');
    const convB_before = await snapshotPanel(page);
    dump('conv_b_before_chat', convB_before);

    // ─────────────────────────────────────────────
    // STEP 6: Conv B — chat
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 6: Conv B — sending message ---');
    const msgB = 'What is the secret word?';
    const resB = await backend.chat(msgB);
    console.log(`🤖 Conv B response: "${resB.response}"`);
    dump('conv_b_chat_response', resB.response);
    dump('conv_b_chat_fullPanel', resB.fullPanel || '(empty)');

    const convB_after = await snapshotPanel(page);
    dump('conv_b_after_chat_panel', convB_after);
    const manualDiffB = diffSnapshots(convB_before, convB_after, msgB);
    dump('conv_b_manual_diff', manualDiffB);

    // ─────────────────────────────────────────────
    // STEP 7: List conversations
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 7: List conversations ---');
    const list = await backend.listConversations();
    dump('conversation_list', JSON.stringify(list, null, 2));
    console.log(`Found ${list.length} conversations:`);
    list.slice(0, 5).forEach((item, i) => console.log(`  [${i}] ${item.title}`));

    if (list.length < 2) {
      throw new Error('Expected at least 2 conversations');
    }
    const targetConvId = list[1].id;
    console.log(`Target conv id: "${targetConvId}"`);

    // ─────────────────────────────────────────────
    // STEP 8: 切换前拍面板
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 8: Before switch ---');
    const beforeSwitch = await snapshotPanel(page);
    dump('before_switch', beforeSwitch);

    // ─────────────────────────────────────────────
    // STEP 9: 切换到 Conv A
    // ─────────────────────────────────────────────
    console.log(`\n--- STEP 9: Switching to conv "${targetConvId}" ---`);
    await backend.switchToConversation(targetConvId);
    const afterSwitch = await snapshotPanel(page);
    dump('after_switch_to_conv_a', afterSwitch);

    // ─────────────────────────────────────────────
    // STEP 10: 切换后 — before snapshot for follow-up
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 10: Conv A (switched) — before snapshot ---');
    const switchedA_before = await snapshotPanel(page);
    dump('switched_conv_a_before_chat', switchedA_before);

    // ─────────────────────────────────────────────
    // STEP 11: Conv A — follow-up chat
    // ─────────────────────────────────────────────
    console.log('\n--- STEP 11: Conv A (switched) — sending follow-up ---');
    const snippet = resB.response.substring(0, 50);
    const followUp = `In another conversation, I asked you the secret word and you said: "${snippet}...". But in THIS conversation, what was the secret word again?`;
    dump('follow_up_message_sent', followUp);

    const resA2 = await backend.chat(followUp);
    console.log(`🤖 Conv A follow-up response: "${resA2.response}"`);
    dump('switched_conv_a_response', resA2.response);
    dump('switched_conv_a_fullPanel', resA2.fullPanel || '(empty)');

    const switchedA_after = await snapshotPanel(page);
    dump('switched_conv_a_after_chat_panel', switchedA_after);
    const manualDiffA2 = diffSnapshots(switchedA_before, switchedA_after, followUp);
    dump('switched_conv_a_manual_diff', manualDiffA2);

    // ─────────────────────────────────────────────
    // 结果汇总
    // ─────────────────────────────────────────────
    console.log('\n\n=== SUMMARY ===');
    console.log(`Conv A first response : "${resA.response}"`);
    console.log(`Conv B response       : "${resB.response}"`);
    console.log(`Conv A follow-up      : "${resA2.response}"`);
    console.log(`\nAll ${stepCounter} snapshots dumped to: ${OUT_DIR}`);

  } catch (error) {
    console.error('\n❌ Error:', error);
    try {
      const errSnap = await snapshotPanel(page);
      dump('error_panel', errSnap);
    } catch {}
    process.exit(1);
  } finally {
    await backend.disconnect();
    console.log('\n=== Done ===');
  }
}

main().catch(console.error);

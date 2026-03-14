/**
 * E2E 测试: 对话切换功能
 *
 * 验证:
 * 1. 能够在多个对话之间切换
 * 2. 切换后能继续对话并保持上下文
 *
 * 执行: cd ts && npx tsx packages/cli/tests/e2e-switch.test.ts
 */

import { AgBackend } from '@coacker/backend';

async function main() {
  console.log('=== E2E Test: Conversation Switching ===\n');

  const backend = new AgBackend({
    endpointUrl: 'http://localhost:9222',
    humanize: true, // 需要人味儿，切换 UI 有延迟
  });

  console.log('Connecting to IDE...');
  const title = await backend.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  try {
    // -------------------------------------------------------------
    console.log('--- ROUND 1: CONV A ---');
    await backend.newConversation();
    console.log('💬 Conv A > "We are playing a game. The secret word is ALBATROSS. Remember it."');
    const resA1 = await backend.chat('We are playing a game. The secret word is ALBATROSS. Remember it. Reply "OK" if you understand.');
    console.log(`🤖 Conv A < ${resA1.response}\n`);

    // -------------------------------------------------------------
    console.log('--- ROUND 2: CONV B ---');
    await backend.newConversation();
    console.log('💬 Conv B > "What is the secret word?" (Should NOT know)');
    const resB1 = await backend.chat('What is the secret word?');
    console.log(`🤖 Conv B < ${resB1.response}\n`);

    // -------------------------------------------------------------
    console.log('--- LIST CONVERSATIONS ---');
    const list = await backend.listConversations();
    console.log(`Found ${list.length} conversations:`);
    list.slice(0, 5).forEach((item, i) => console.log(`  [${i}] ${item.title}`));
    console.log('');

    // 第0个是我们刚创建的 Conv B，第1个是我们之前创建的 Conv A。
    // 但是 AI 自动生成的标题不一定精确，所以我们可以直接选第1个历史记录。
    if (list.length < 2) {
      throw new Error('Expected at least 2 conversations to test switching.');
    }
    const targetConvId = list[1].id;
    
    // -------------------------------------------------------------
    console.log(`--- ROUND 3: SWITCH TO CONV A ("${targetConvId}") ---`);
    await backend.switchToConversation(targetConvId);
    console.log('💬 Conv A > "What was the secret word again?" (SHOULD know)');
    
    // 我们把 Conv B 的干扰也告诉它，制造一点戏剧性
    const resA2 = await backend.chat(`In another conversation, I asked you the secret word and you said: "${resA1.response.substring(0, 50)}...". But in THIS conversation, what was the secret word again?`);
    console.log(`🤖 Conv A < ${resA2.response}\n`);

    // 可以在这里断言
    if (resA2.response.toLowerCase().includes('albatross')) {
      console.log('✅ Context correctly restored after switch!');
    } else {
      console.log('❌ Context NOT restored properly.');
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  } finally {
    console.log('\nDisconnecting...');
    await backend.disconnect();
    console.log('=== Done ===');
  }
}

main().catch(console.error);

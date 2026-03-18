/**
 * E2E 测试: Retry 检测与自动重试
 *
 * 1. 连接到 IDE
 * 2. 切换到 "Audit Consolidation Report" 对话 (已知有 error terminated 状态)
 * 3. 检测 Retry 按钮是否存在
 * 4. 点击 Retry
 * 5. 观察状态变化
 *
 * 执行: cd ~/Coacker && npx tsx packages/cli/tests/e2e-retry.test.ts
 */

import { AgBackend } from '@coacker/backend';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== E2E Test: Retry Detection ===\n');

  const backend = new AgBackend({
    endpointUrl: 'http://localhost:19223',
    humanize: false,
    windowTitle: 'Coacker',
  });

  console.log('Connecting...');
  const title = await backend.connect('Coacker');
  console.log(`✅ Connected: ${title}\n`);

  // 拿到底层 AG 实例, 直接用 detectState / clickRetry
  const ag = backend.raw;
  const page = ag.page;

  // detectState / clickRetry 从 ag 内部模块导入
  const { detectState, clickRetry } = await import(
    '../../backend/src/ag/state.js'
  );

  try {
    // ── Step 1: 列出对话, 找 "Audit Consolidation Report" ──
    console.log('Step 1: Listing conversations...');
    const convs = await backend.listConversations();
    console.log(`  Found ${convs.length} conversations:`);
    convs.forEach(c => console.log(`    • ${c.title}`));

    const target = convs.find(c =>
      c.title.toLowerCase().includes('audit consolidation')
    );

    if (!target) {
      console.log('\n❌ "Audit Consolidation Report" conversation not found.');
      console.log('   Available conversations listed above.');
      return;
    }

    console.log(`\n  ✅ Found target: "${target.title}"\n`);

    // ── Step 2: 切换到目标对话 ──
    console.log('Step 2: Switching to conversation...');
    await backend.switchToConversation(target.id);
    console.log('  ✅ Switched.\n');

    // 等一下让 UI 渲染完
    await sleep(2000);

    // ── Step 3: 截屏 (before) ──
    const screenshotBefore = '/tmp/retry_test_before.png';
    await page.screenshot({ path: screenshotBefore });
    console.log(`  📸 Screenshot (before): ${screenshotBefore}`);

    // ── Step 4: 检测当前状态 ──
    console.log('\nStep 3: Detecting state...');
    const state = await detectState(page);
    console.log(`  State: ${state}`);

    // dump 所有可见按钮
    const buttons = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      const visible: string[] = [];
      for (const b of btns) {
        const el = b as HTMLElement;
        if (el.offsetParent) {
          const text = el.textContent?.trim() ?? '';
          if (text.length > 0 && text.length < 100) visible.push(text);
        }
      }
      return visible;
    });
    console.log(`  Visible buttons: [${buttons.join(', ')}]`);

    if (state === 'error_terminated') {
      console.log('  ✅ ERROR_TERMINATED detected! Retry button is visible.\n');
    } else {
      console.log(`\n  ⚠️  State is "${state}", not error_terminated.`);
      console.log('     The conversation may not be in an error state.');
      console.log('     Test complete (no retry to click).\n');
      return;
    }

    // ── Step 5: 点击 Retry ──
    console.log('Step 4: Clicking Retry...');
    const clicked = await clickRetry(page);
    console.log(`  clickRetry returned: ${clicked}`);

    if (clicked) {
      console.log('  ✅ Retry button clicked!\n');
    } else {
      console.log('  ❌ Failed to click Retry button.\n');
      return;
    }

    // ── Step 6: 等待 + 观察状态变化 ──
    console.log('Step 5: Watching state changes (10s)...');
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const newState = await detectState(page);
      const elapsed = (i + 1) * 2;
      console.log(`  [${elapsed}s] State: ${newState}`);

      if (newState === 'idle') {
        console.log('  ✅ Agent completed!');
        break;
      }
    }

    // 截屏 (after)
    const screenshotAfter = '/tmp/retry_test_after.png';
    await page.screenshot({ path: screenshotAfter });
    console.log(`\n  📸 Screenshot (after): ${screenshotAfter}`);

  } finally {
    await backend.disconnect();
    console.log('\nDisconnected.');
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

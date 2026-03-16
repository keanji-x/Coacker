/**
 * Test getConversationTitle against live Antigravity
 *
 * Tests two scenarios:
 *   1. Existing conversation — should return the current title
 *   2. After newConversation() — should be empty or short
 *
 * Usage: cd ~/Coacker && npx tsx packages/cli/tests/test-conv-title.ts
 */

import { Antigravity } from "../../backend/src/ag/client.js";
import { getConversationTitle } from "../../backend/src/ag/state.js";
import { loadConfig, getBackendConfig } from "@coacker/shared";

async function main() {
  const cfg = loadConfig();
  const backendCfg = getBackendConfig(cfg);

  const ag = new Antigravity({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: false,
  });

  const pageTitle = await ag.connect(backendCfg.ag?.windowTitle);
  console.log("Connected to:", pageTitle);

  // ── Test 1: 当前已有的对话标题 ──
  console.log("\n── Test 1: Existing conversation title ──");
  const existingTitle = await getConversationTitle(ag.page);
  console.log(`  Title: "${existingTitle}"`);
  console.log(`  Length: ${existingTitle.length}`);
  console.log(
    existingTitle.length > 0
      ? "  ✅ Got title from existing conversation"
      : "  ⚠️ Title is empty (may be a fresh/blank conversation)",
  );

  // ── Test 2: 新建对话后的标题 ──
  console.log("\n── Test 2: After newConversation() ──");
  await ag.newConversation();
  // 等待 UI 渲染
  await new Promise((r) => setTimeout(r, 1000));

  const newTitle = await getConversationTitle(ag.page);
  console.log(`  Title: "${newTitle}"`);
  console.log(`  Length: ${newTitle.length}`);
  console.log(
    newTitle.length === 0
      ? "  ✅ Empty title on new conversation (expected)"
      : `  ℹ️ Got title: "${newTitle}" (IDE may reuse/keep title)`,
  );

  // ── Test 3: 切回原来的对话 (如果可以) ──
  // 这里不切换，因为可能破坏用户状态。只是确认新对话后能拿到 title 变化。

  await ag.disconnect();
  console.log("\nDone!");
}

main().catch(console.error);

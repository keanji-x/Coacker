/**
 * @coacker/player — 上下文工程
 *
 * 将 TaskStep 转换为 Backend 能理解的 prompt。
 * 角色 prompt 和用户消息分离，拼接为完整 prompt。
 */

import type { TaskStep } from "@coacker/shared";

/**
 * 从 TaskStep 构建完整的 prompt
 *
 * 将角色 system prompt 和用户消息拼接在一起。
 * 角色 prompt 作为前缀，用分隔线与用户消息分开。
 *
 * @param step - 任务步骤
 * @param rolePrompts - 角色 prompt 映射 (实例级)
 */
export function buildStepPrompt(
  step: TaskStep,
  rolePrompts: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];

  // 角色 prompt (如果注册了)
  const rolePrompt = rolePrompts.get(step.role);
  if (rolePrompt) {
    parts.push(rolePrompt);
    parts.push("\n---\n");
  }

  // 用户消息
  parts.push(step.message);

  return parts.join("\n");
}

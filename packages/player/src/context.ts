/**
 * @coacker/player — 上下文工程
 *
 * 将 TaskStep 转换为 Backend 能理解的 prompt。
 * 角色 prompt 和用户消息分离，拼接为完整 prompt。
 */

import type { TaskStep } from '@coacker/shared';

/** 角色 prompt 映射 */
const ROLE_PROMPTS: Map<string, string> = new Map();

/** 注册角色 prompt */
export function registerRolePrompt(role: string, prompt: string): void {
  ROLE_PROMPTS.set(role, prompt);
}

/** 批量注册角色 prompts */
export function registerRolePrompts(prompts: Record<string, string>): void {
  for (const [role, prompt] of Object.entries(prompts)) {
    ROLE_PROMPTS.set(role, prompt);
  }
}

/** 获取角色 prompt */
export function getRolePrompt(role: string): string | undefined {
  return ROLE_PROMPTS.get(role);
}

/**
 * 从 TaskStep 构建完整的 prompt
 *
 * 将角色 system prompt 和用户消息拼接在一起。
 * 角色 prompt 作为前缀，用分隔线与用户消息分开。
 */
export function buildStepPrompt(step: TaskStep): string {
  const parts: string[] = [];

  // 角色 prompt (如果注册了)
  const rolePrompt = ROLE_PROMPTS.get(step.role);
  if (rolePrompt) {
    parts.push(rolePrompt);
    parts.push('\n---\n');
  }

  // 用户消息
  parts.push(step.message);

  return parts.join('\n');
}

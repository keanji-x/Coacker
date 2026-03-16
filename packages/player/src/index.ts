/**
 * @coacker/player — Public API
 */

export { Player } from "./player.js";
export type { PlayerOptions, ConversationRecord } from "./player.js";
export {
  buildStepPrompt,
  registerRolePrompt,
  registerRolePrompts,
  getRolePrompt,
} from "./context.js";
export { collectStepResult, extractJSON, truncate } from "./collector.js";

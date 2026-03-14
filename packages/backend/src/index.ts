/**
 * @coacker/backend — Public API
 *
 * 导出:
 *   - Backend 接口 (Player 只依赖这个)
 *   - AgBackend 实现 (通过工厂函数或直接实例化)
 */

// 接口
export type {
  Backend,
  BackendOptions,
  ChatResult,
  ChatOptions,
} from './interface.js';

// AG 实现
export { AgBackend } from './ag-backend.js';
export type { AgBackendOptions } from './ag-backend.js';

// Mock 实现 (测试用)
export { MockBackend } from './mock-backend.js';
export type { MockResponse } from './mock-backend.js';

// 工厂
import type { Backend, BackendOptions } from './interface.js';
import { AgBackend } from './ag-backend.js';
import type { AgBackendOptions } from './ag-backend.js';

export type BackendType = 'ag';

/**
 * 工厂函数: 根据类型创建 Backend 实例
 *
 * @example
 * const backend = createBackend('ag', { endpointUrl: 'http://localhost:9222' });
 */
export function createBackend(type: BackendType, options?: BackendOptions): Backend {
  switch (type) {
    case 'ag':
      return new AgBackend(options as AgBackendOptions);
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

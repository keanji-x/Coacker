import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * McpBackend: 基于 MCP 协议的标准通信客户端后端
 * 用于直接对接 rust-analyzer / solidity-lsp，无需前台渲染 UI
 */
export class McpBackend {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({
      name: "coacker-mcp-client",
      version: "3.0.0"
    }, {
      capabilities: {}
    });
  }

  /**
   * 连接到目标 MCP Server (例如通过 stdio 调用 npx 或二进制文件)
   */
  async connect(command: string, args: string[], env?: Record<string, string>) {
    this.transport = new StdioClientTransport({
      command,
      args,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env })
          .filter((e): e is [string, string] => e[1] !== undefined)
      ),
    });
    
    await this.client.connect(this.transport);
  }

  /**
   * 关闭连接
   */
  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /**
   * 获取 MCP Server 支持的所有工具列表
   */
  async listTools() {
    return await this.client.listTools();
  }

  /**
   * 直接调用服务端工具 (例如: get_definition, find_references)
   */
  async callTool(name: string, args: any) {
    return await this.client.callTool({ name, arguments: args });
  }
}

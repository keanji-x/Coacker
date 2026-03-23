import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

/**
 * Sandbox: 受限终端环境
 * 用于让 AI 执行编译构建和写入 PoC 测试文件，过滤危险环境的侧漏风险。
 * 作为 Toolkit 辅助工具使用，不是 Backend 实现。
 */
export class Sandbox {
  private pocDir: string;
  private allowedCommands: Set<string>;
  private deniedArgs = new Set(['--config', 'run', 'build.rs']);

  constructor(baseDir: string = process.cwd(), extraCommands?: string[]) {
    const defaults = ['cargo', 'forge', 'gh', 'git'];
    this.allowedCommands = new Set([...defaults, ...(extraCommands ?? [])]);
    this.pocDir = path.join(baseDir, 'tests/audit_poc');
    if (!fs.existsSync(this.pocDir)) {
      fs.mkdirSync(this.pocDir, { recursive: true });
    }
  }

  /**
   * 将大模型生成的测试 PoC 写入受限目录
   */
  async writeFile(filename: string, content: string): Promise<string> {
    const safeName = path.basename(filename); // 防逆向遍历 (../)
    const targetPath = path.join(this.pocDir, safeName);
    await fs.promises.writeFile(targetPath, content, 'utf8');
    return `Successfully wrote to tests/audit_poc/${safeName}`;
  }

  /**
   * 安全执行 Shell 指令
   */
  async execute(command: string, args: string[], cwd: string = process.cwd(), timeoutMs: number = 180000): Promise<SandboxResult> {
    if (!this.allowedCommands.has(command)) {
      throw new Error(`[Sandbox Error] Command '${command}' is not in the allowed list: ${Array.from(this.allowedCommands).join(', ')}`);
    }

    for (const arg of args) {
      if (this.deniedArgs.has(arg)) {
        throw new Error(`[Sandbox Error] Argument '${arg}' is blocked for security reasons.`);
      }
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, shell: false });
      
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      let timer: NodeJS.Timeout;
      
      const finish = (code: number | null) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code,
          durationMs: Date.now() - startTime
        });
      };

      proc.on('close', code => finish(code));
      proc.on('error', err => {
        stderr += `\n[Process Error] ${err.message}`;
        finish(1);
      });

      // Timeout Enforcer
      timer = setTimeout(() => {
        proc.kill('SIGKILL');
        stderr += `\n[Sandbox Timeout] Process killed after ${timeoutMs}ms`;
        finish(1);
      }, timeoutMs);
    });
  }
}

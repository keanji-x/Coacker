/**
 * @coacker/brain — 知识库
 *
 * 本地 JSON 文件存储，支持 CRUD 和按标签/任务检索。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeEntry } from '@coacker/shared';

const STORE_FILE = 'knowledge.json';

export class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry> = new Map();
  private storeDir: string;
  private dirty = false;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.load();
  }

  /** 从磁盘加载 */
  private load(): void {
    const path = join(this.storeDir, STORE_FILE);
    if (!existsSync(path)) return;

    try {
      const raw = readFileSync(path, 'utf-8');
      const arr: KnowledgeEntry[] = JSON.parse(raw);
      for (const entry of arr) {
        this.entries.set(entry.id, entry);
      }
    } catch {
      // corrupted file, start fresh
    }
  }

  /** 持久化到磁盘 */
  save(): void {
    if (!this.dirty) return;
    mkdirSync(this.storeDir, { recursive: true });
    const path = join(this.storeDir, STORE_FILE);
    const arr = Array.from(this.entries.values());
    writeFileSync(path, JSON.stringify(arr, null, 2), 'utf-8');
    this.dirty = false;
  }

  /** 添加或更新知识条目 */
  put(entry: KnowledgeEntry): void {
    entry.updatedAt = Date.now();
    this.entries.set(entry.id, entry);
    this.dirty = true;
  }

  /** 获取知识条目 */
  get(id: string): KnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  /** 删除知识条目 */
  delete(id: string): boolean {
    const result = this.entries.delete(id);
    if (result) this.dirty = true;
    return result;
  }

  /** 按标签检索 */
  findByTag(tag: string): KnowledgeEntry[] {
    return Array.from(this.entries.values()).filter(e => e.tags.includes(tag));
  }

  /** 按来源任务检索 */
  findByTask(taskId: string): KnowledgeEntry[] {
    return Array.from(this.entries.values()).filter(e => e.sourceTaskId === taskId);
  }

  /** 所有条目 */
  all(): KnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  /** 条目数量 */
  get size(): number {
    return this.entries.size;
  }

  /** 导出为 Markdown 摘要 */
  toMarkdown(): string {
    const lines = [`# Knowledge Base (${this.size} entries)\n`];
    for (const entry of this.entries.values()) {
      lines.push(`## ${entry.title}`);
      lines.push(`- **ID:** ${entry.id}`);
      lines.push(`- **Tags:** ${entry.tags.join(', ') || 'none'}`);
      lines.push(`- **Source:** ${entry.sourceTaskId}`);
      lines.push('');
      lines.push(entry.content.slice(0, 200));
      lines.push('');
    }
    return lines.join('\n');
  }
}

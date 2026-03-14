/**
 * @coacker/player — Skills 管理
 *
 * 从 skills 目录加载 .md 文件，按名称索引。
 * Player 在构建上下文时将 skill 内容注入 prompt。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface Skill {
  /** Skill 名称 (不含扩展名) */
  name: string;
  /** Skill 内容 (Markdown) */
  content: string;
  /** 文件路径 */
  path: string;
}

/** 已加载的 skills 缓存 */
const _cache = new Map<string, Skill>();

/**
 * 加载 skills 目录下的所有 .md 文件
 */
export function loadSkills(skillsDir: string): Map<string, Skill> {
  if (!existsSync(skillsDir)) return _cache;

  const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const name = basename(file, '.md');
    if (_cache.has(name)) continue;

    const path = join(skillsDir, file);
    const content = readFileSync(path, 'utf-8');
    _cache.set(name, { name, content, path });
  }

  return _cache;
}

/**
 * 按名称获取 skill 内容
 */
export function getSkill(name: string): Skill | undefined {
  return _cache.get(name);
}

/**
 * 获取多个 skills 的合并内容
 */
export function getSkillsContent(names: string[]): string {
  const parts: string[] = [];
  for (const name of names) {
    const skill = _cache.get(name);
    if (skill) {
      parts.push(`### Skill: ${skill.name}\n\n${skill.content}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

/** 清空缓存 (测试用) */
export function resetSkills(): void {
  _cache.clear();
}

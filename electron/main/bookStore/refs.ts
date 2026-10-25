// 「本书存在哪些实体 id」的单一定源（Task 8 环拆重构）。
// 背景：Task 7 结束时 characters.ts ↔ world.ts 互为「函数级」循环依赖
// （characters 引 listWorldEntryIds、world 引 listCharacters/listVolumes）——虽是 hoisted
// function 语义下可跑，但引用目标集本就是一个跨仓库概念，不该由任一仓库私有。
// 本文件只导入 paths + docStore + schema(UUID_PATTERN)，零仓库导入，因此任何 repository
// 都可以安全地 import refs 而绝不构成环（characters/world/volumes/chapters → refs 单向）。
// 语义纪律：这里做的是「存在性直扫」（只看目录与文件名 stem），不读内容、不校验档——
// 与 Task 7 listWorldEntryIds 的宽容扫描同一取向；引用检查两侧共用此集合，避免
// 「宽容存在性」与「严格列表」的目标集分裂（严格视图仍由各仓库 listXxx 提供）。
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { UUID_PATTERN } from '../../../src/common/schema'
import { chaptersDir, charactersDir, volumesDir, worldDir } from './paths'
import { listYamlFiles } from './docStore'

const YAML_EXT = '.yaml'
const MD_EXT = '.md'

/** 章 id：chapters/*.md 的 stem，按 UUID_PATTERN 过滤（畸形/遗留命名文件跳过——章文件名即 id）。 */
export function chapterIds(p: string): string[] {
  const dir = chaptersDir(p)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(MD_EXT))
    .map((entry) => entry.name.slice(0, -MD_EXT.length))
    .filter((stem) => UUID_PATTERN.test(stem))
    .sort()
}

/** 角色 id：characters/*.yaml 的 stem，按 UUID_PATTERN 过滤（畸形/遗留命名文件跳过）。 */
export function characterIds(p: string): string[] {
  return listYamlFiles(charactersDir(p))
    .map((name) => name.slice(0, -YAML_EXT.length))
    .filter((stem) => UUID_PATTERN.test(stem))
}

/**
 * 世界观词条 id：world/<任意子目录>/<stem>.yaml 的全目录宽容直扫。
 * 逐字镜像 Task 7 world.listWorldEntryIds 的现状语义：每个子目录都扫（含非枚举目录）、
 * 只认 stem、不做 UUID 过滤、不校验内容、目录缺失 → []。控制器裁定（Task 8）：
 * 保持宽容、不趁机收紧过滤——收紧会把「文件在但档坏」的词条从目标集中抹掉，
 * 使指向它们的存量边在下次编辑时被误判为「新引入幻影」。
 */
export function worldIds(p: string): string[] {
  const root = worldDir(p)
  if (!existsSync(root)) return []
  const ids: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const file of listYamlFiles(join(root, entry.name))) {
      ids.push(file.slice(0, -YAML_EXT.length))
    }
  }
  return ids
}

/** 卷 id：volumes/*.yaml 的 stem（stem 即 id——与卷仓库「文件名权威」同义；不过滤、不读档）。 */
export function volumeIds(p: string): string[] {
  return listYamlFiles(volumesDir(p)).map((name) => name.slice(0, -YAML_EXT.length))
}

/** 全部实体 id 的并集（章 ∪ 角色 ∪ 卷 ∪ 词条；去重、升序）——剧情线 stages[].entityIds 的合法目标集。 */
export function allEntityIds(p: string): string[] {
  return [...new Set([...chapterIds(p), ...characterIds(p), ...worldIds(p), ...volumeIds(p)])].sort()
}

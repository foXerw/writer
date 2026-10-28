// v2 书目录布局的唯一权威（主进程代码，一律相对导入，不走 '@' 别名）。
// 设计约定（M2 计划 Global Constraints）：
// - 文件名一律纯 ASCII：实体文件 = `<id>.yaml`（章节正文 = `<id>.md`），中文只出现在内容字段；
// - `backupStamp` 产出的目录名对 ISO 时间戳做消毒——Windows 文件名禁止 `:`。
import { join } from 'node:path'
import type { SettingCategory } from '../../../src/common/ipc'

export const BACKUP_DIR_NAME = '.migration-backup'

export function bookJsonPath(p: string): string {
  return join(p, 'book.json')
}

export function chaptersDir(p: string): string {
  return join(p, 'chapters')
}

export function chapterFile(p: string, id: string): string {
  return join(chaptersDir(p), `${id}.md`)
}

export function volumesDir(p: string): string {
  return join(p, 'volumes')
}

export function volumeFile(p: string, id: string): string {
  return join(volumesDir(p), `${id}.yaml`)
}

export function charactersDir(p: string): string {
  return join(p, 'characters')
}

export function characterFile(p: string, id: string): string {
  return join(charactersDir(p), `${id}.yaml`)
}

export function worldDir(p: string): string {
  return join(p, 'world')
}

/** SettingCategory 枚举值已是英文，slug 即其本身。 */
export function categorySlug(c: SettingCategory): string {
  return c
}

export function worldEntryFile(p: string, category: SettingCategory, id: string): string {
  return join(worldDir(p), categorySlug(category), `${id}.yaml`)
}

export function plotlinesDir(p: string): string {
  return join(p, 'plotlines')
}

export function plotlineFile(p: string, id: string): string {
  return join(plotlinesDir(p), `${id}.yaml`)
}

export function choicesDir(p: string): string {
  return join(p, 'choices')
}

export function choiceFile(p: string, id: string): string {
  return join(choicesDir(p), `${id}.yaml`)
}

export function foreshadowFile(p: string): string {
  return join(p, 'foreshadow.yaml')
}

export function backupRoot(p: string): string {
  return join(p, BACKUP_DIR_NAME)
}

// ---------------------------------------------------------------------------
// M4b：`.ai/` 命名空间（AI 产物区——提案 / 章节摘要 / 实体-章节索引）。
// 单文件路径拼接的字符串权威在 src/common/proposal.ts（proposalPath，主/渲染共用纯函数）；
// 此处是主进程目录布局权威（BOOK_FORMAT §7），T4 readAiData 与 T3 仓库/引擎共用，勿再手拼。
// ---------------------------------------------------------------------------

/** 提案目录 `.ai/proposals/`（文件名 `<id>.yaml`，id 非 UUID——BAD_PROPOSAL_ID 门守形状）。 */
export function proposalsDir(p: string): string {
  return join(p, '.ai', 'proposals')
}

/** 章节摘要目录 `.ai/summaries/chapters/`。 */
export function chapterSummariesDir(p: string): string {
  return join(p, '.ai', 'summaries', 'chapters')
}

/** 单章摘要文件 `.ai/summaries/chapters/<chapterId>.yaml`（chapterId 必须已过章存在性检查——UUID）。 */
export function chapterSummaryFile(p: string, chapterId: string): string {
  return join(chapterSummariesDir(p), `${chapterId}.yaml`)
}

/** 卷摘要目录 `.ai/summaries/volumes/`（写侧 M4c 才投产；readAiData 已按同布局宽容读）。 */
export function volumeSummariesDir(p: string): string {
  return join(p, '.ai', 'summaries', 'volumes')
}

/** 实体-章节索引单文件 `.ai/index.json`（spec G7 原文：Record<entityId, chapterId[]>，真 JSON 字节）。 */
export function aiIndexFile(p: string): string {
  return join(p, '.ai', 'index.json')
}

/**
 * 备份目录的相对路径（相对书根）：`.migration-backup/<消毒后的 tsIso>`。
 * 消毒 = 把 Windows/POSIX 文件名非法或易碎的字符（`:` `/`）替换为 `-`，
 * 保证 `join(bookPath, backupStamp(new Date().toISOString()))` 全平台可用。
 */
export function backupStamp(tsIso: string): string {
  const safe = tsIso.replace(/[:/]/g, '-')
  return `${BACKUP_DIR_NAME}/${safe}`
}

// ---------------------------------------------------------------------------
// Task 9：文件监听 → 缓存域映射（裁定 3）
// ---------------------------------------------------------------------------

/** 缓存/监听域：五个 repository 各占一域（narrative 统辖 plotlines/choices/foreshadow.yaml）。 */
export type BookDomain = 'chapters' | 'characters' | 'world' | 'volumes' | 'narrative'

/**
 * 相对书根的路径 → 所属域；不归属任何实体域 → null。
 * 裁定 3 钉死映射：chapters/→chapters、characters/→characters、world/→world、volumes/→volumes、
 * foreshadow.yaml | plotlines/ | choices/ →narrative；其余（含 book.json——配置变更不失效实体域、
 * .migration-backup/ 迁移备份、未知散落文件）一律 null，watcher 据此忽略事件。
 * 入参容反斜杠（先归一为正斜杠）。
 *
 * 裸目录名（'chapters' 等，无尾斜杠）刻意归 null：Windows recursive watch 在目录内建/删文件时
 * 会额外上报目录自身的 mtime 事件，严格前缀语义把它们整体过滤（域归属只认文件路径）——
 * 代价是「整个域目录被外部整体删除」不触发失效，属 watcher 停摆同级的可接受陈旧（裁定 2）。
 */
export function domainOf(relPath: string): BookDomain | null {
  // 归一：反斜杠 → 正斜杠；尾斜杠剥除（部分平台的目录事件带尾分隔符——剥除后归入裸目录名 → null）
  const rel = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (rel.startsWith('chapters/')) return 'chapters'
  if (rel.startsWith('characters/')) return 'characters'
  if (rel.startsWith('world/')) return 'world'
  if (rel.startsWith('volumes/')) return 'volumes'
  if (rel === 'foreshadow.yaml') return 'narrative'
  if (rel.startsWith('plotlines/')) return 'narrative'
  if (rel.startsWith('choices/')) return 'narrative'
  return null
}

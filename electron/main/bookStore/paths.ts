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

/**
 * 备份目录的相对路径（相对书根）：`.migration-backup/<消毒后的 tsIso>`。
 * 消毒 = 把 Windows/POSIX 文件名非法或易碎的字符（`:` `/`）替换为 `-`，
 * 保证 `join(bookPath, backupStamp(new Date().toISOString()))` 全平台可用。
 */
export function backupStamp(tsIso: string): string {
  const safe = tsIso.replace(/[:/]/g, '-')
  return `${BACKUP_DIR_NAME}/${safe}`
}

// 项目格式探测：v2 / v1 / invalid 三态判定（数据安全 > 可用性）。
// 优先级钉死：book.json 占住 v2 槽位即 fail-closed——坏档/版本不符一律抛 CORRUPT_BOOK，
// 绝不静默降级成 v1 触发重迁（迁移会改写书目录，把损坏扩大成灾难）；仅当 book.json 不存在才落 v1/invalid。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FORMAT_VERSION } from '../../../src/common/schema'
import { readYamlFile } from './docStore'
import { bookJsonPath } from './paths'

export const V1_MARKER_FILE = '.novelwriter.json'
export const V1_MIGRATED_FILE = '.novelwriter.json.migrated'

export type BookFormat = 'v2' | 'v1' | 'invalid'

export function detectFormat(projectPath: string): BookFormat {
  const bookPath = bookJsonPath(projectPath)
  if (existsSync(bookPath)) {
    let raw: unknown
    try {
      raw = readYamlFile<unknown>(bookPath)
    } catch (err) {
      throw corruptBook(bookPath, err)
    }
    if (isRecord(raw) && raw.formatVersion === FORMAT_VERSION) {
      return 'v2'
    }
    throw corruptBook(bookPath)
  }
  if (existsSync(join(projectPath, V1_MARKER_FILE))) return 'v1'
  // 半迁移救援：旧标记已改名 .migrated 而 book.json 缺失/未落成 → 视为待（重）迁 v1，
  // migrateBook 的备份步骤会先保护现状再改写。
  if (existsSync(join(projectPath, V1_MIGRATED_FILE))) return 'v1'
  return 'invalid'
}

function corruptBook(bookPath: string, cause?: unknown): Error {
  const detail = cause instanceof Error ? ` (${cause.message})` : ''
  return new Error(`CORRUPT_BOOK: ${bookPath}${detail}`)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

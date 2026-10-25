import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 迁移完成标记文件名（写入 newDir 根下，内容为一行 ISO 时间戳）。 */
const MIGRATION_MARKER = '.migrated'

/**
 * userData 目录搬运结果。
 * - 'migrated'：旧目录内容已合并复制进新目录，且已写入 '.migrated' 标记
 * - 'skipped'：无需/不能搬运（oldDir 不存在、标记已存在即迁移已完成、或复制异常待下次重试）
 */
export type MigrateUserDataResult = 'migrated' | 'skipped'

/**
 * 产品更名 novel-writer → perfect-novel 后，Electron 的 userData 目录名派生自
 * package.json 的 "name"，theme.json / 窗口几何 / zustand 持久化 localStorage
 *（recent projects、编辑器设置等，位于 userData/Local Storage/）会随之换目录。
 * 首次启动时把旧目录（%APPDATA%/novel-writer）内容合并复制进新目录
 *（%APPDATA%/perfect-novel），避免用户数据被静默重置。
 *
 * 规则（MARKER + MERGE-COPY）：
 * - oldDir 不存在 → 'skipped'；
 * - newDir/.migrated 已存在 → 'skipped'（幂等，且中断后可安全续跑）；
 * - 否则递归合并复制：逐条目对比相对路径，newDir 已存在同路径条目则跳过
 *（绝不覆盖 Chromium 预写的 Local State 等文件），目录两侧都存在则递归合并；
 * - 成功后写入 '.migrated' 标记（ISO 时间戳）并返回 'migrated'；
 * - 任何异常：记录日志、不写标记、返回 'skipped'（下次启动重试，合并语义保证安全）；
 * - oldDir 始终保留（不删除，便于回退）。
 *
 * 背景：Chromium 可能在 whenReady 回调之前就预建 newDir（如 Local State），
 * 旧实现「newDir 存在即整体跳过」会在真实机器上静默丢失用户数据。
 */
export function migrateUserData(
  oldDir: string,
  newDir: string
): MigrateUserDataResult {
  if (!existsSync(oldDir)) {
    return 'skipped'
  }
  if (existsSync(join(newDir, MIGRATION_MARKER))) {
    return 'skipped'
  }
  try {
    mkdirSync(newDir, { recursive: true })
    mergeCopyInto(oldDir, newDir)
    writeFileSync(join(newDir, MIGRATION_MARKER), new Date().toISOString())
    return 'migrated'
  } catch (error) {
    console.warn('[userData] 搬运失败，跳过迁移（下次启动将重试）', error)
    return 'skipped'
  }
}

/**
 * 把 srcDir 下的全部条目（含隐藏文件、'Local Storage' 等目录）合并复制到 destDir。
 * destDir 中已存在的同相对路径条目一律跳过（不读取、不覆盖）；两侧同名目录递归合并。
 */
function mergeCopyInto(srcDir: string, destDir: string): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      if (existsSync(destPath)) {
        mergeCopyInto(srcPath, destPath)
      } else {
        cpSync(srcPath, destPath, { recursive: true, force: false, errorOnExist: true })
      }
    } else {
      if (existsSync(destPath)) continue
      copyFileSync(srcPath, destPath)
    }
  }
}

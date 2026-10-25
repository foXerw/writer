import { cpSync, existsSync } from 'fs'

/**
 * userData 目录搬运结果。
 * - 'migrated'：旧目录内容已完整复制到新目录
 * - 'skipped'：无需/不能搬运（旧目录不存在、新目录已存在、或复制失败）
 */
export type MigrateUserDataResult = 'migrated' | 'skipped'

/**
 * 产品更名 novel-writer → perfect-novel 后，Electron 的 userData 目录名派生自
 * package.json 的 "name"，theme.json / 窗口状态文件会随之换目录。
 * 首次启动时把旧目录（%APPDATA%/novel-writer）整体搬到新目录（%APPDATA%/perfect-novel），
 * 避免用户主题与窗口几何被静默重置。
 *
 * 规则（与设计文档一致）：
 * - newDir 已存在 → 整体跳过（'skipped'），不做逐文件合并、绝不覆盖现有文件；
 * - oldDir 不存在 → 'skipped'；
 * - 否则递归复制 oldDir 内容到新目录，并保留 oldDir（不删除，便于回退）。
 */
export function migrateUserData(
  oldDir: string,
  newDir: string
): MigrateUserDataResult {
  if (!existsSync(oldDir)) {
    return 'skipped'
  }
  // 先守卫再复制：cpSync 的 force/errorOnExist 无法表达"目标目录已存在即整体跳过"
  if (existsSync(newDir)) {
    return 'skipped'
  }
  try {
    cpSync(oldDir, newDir, { recursive: true, force: false, errorOnExist: false })
    return 'migrated'
  } catch (error) {
    console.warn('[userData] 搬运失败，跳过迁移', error)
    return 'skipped'
  }
}

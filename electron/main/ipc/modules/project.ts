// 项目 create/open：一切书目录读写经 bookStore（M2 Global Constraint——本文件零直接 fs 手术）。
// - project:create → v2 骨架（book.json + chapters/volumes/characters/world + 空台账），不再写 .novelwriter.json；
// - project:open → detectFormat 三态：v1 先就地迁移（带时间戳备份）再按 v2 读；v2 直读（但旧标记未改名
//   = 崩溃中断态 → 自动续传补完，R1 接线见 Task 10）；invalid 抛 INVALID_PROJECT；
//   CORRUPT_BOOK 一律捕获后以用户可读文案重抛（前缀契约：渲染层按 `CORRUPT_BOOK:` 展示，toast 接线在 Task 10）。
// - ProjectData.id 自此为 book.json 的稳定书 id（不再每次打开 randomUUID）。
// - Task 9 接线（裁定 4/8）：create 成功后、open 的迁移+自检全部完成后 → startWatching(projectPath, win)。
//   顺序钉死：watch 绝不在迁移期间启动（大规模文件改写不得进 watcher 事件）；startWatching 内部先停
//   前一个监听并清其五域缓存——打开另一本书天然完成切换与陈旧缓存清理。
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { MigrationReport, ProjectData, ProjectType } from '../../../../src/common/ipc'
import type { BookMeta } from '../../../../src/common/schema'
import { readYamlFile } from '../../bookStore/docStore'
import { detectFormat, hasInterruptedMigration } from '../../bookStore/format'
import { createBookSkeleton, migrateBook, validateMigration } from '../../bookStore/migrate'
import { bookJsonPath } from '../../bookStore/paths'
import { startWatching } from '../../bookStore/watcher'
import { formatFilePath } from '../helpers'

/**
 * 从 IPC 事件解析窗口并启动书目录监听。防御：sender 缺失/解析不到窗口 → 跳过（监听只影响
 * 外部变更的自动刷新，绝不反过来阻塞 create/open 主流程；startWatching 自身永不抛，见 watcher.ts）。
 */
function beginWatching(event: IpcMainInvokeEvent | null, p: string): void {
  const sender = event?.sender
  const win = sender ? BrowserWindow.fromWebContents(sender) : null
  if (win) startWatching(p, win)
}

export function registerProjectHandlers(): void {
  // 创建项目：v2 骨架
  ipcMain.handle(
    'project:create',
    async (event, params: { name: string; path: string; type: ProjectType }) => {
      const { name, path: parentPath, type } = params
      const projectDir = join(parentPath, name)

      const meta = createBookSkeleton(projectDir, name, type)
      beginWatching(event, projectDir) // 骨架已落盘（无迁移环节）→ 立即监听（Task 9 裁定 4）

      const projectData: ProjectData = {
        id: meta.id,
        name: meta.name,
        path: formatFilePath(projectDir),
        type: meta.type,
        createdAt: new Date(),
        updatedAt: new Date(),
        config: meta.config,
        migration: null
      }
      return projectData
    }
  )

  // 打开项目：v1 → 先迁移再按 v2 读；迁移报告随 ProjectData.migration 返回
  ipcMain.handle('project:open', async (event, projectPath: string) => {
    try {
      const format = detectFormat(projectPath)
      if (format === 'invalid') {
        throw new Error(
          'INVALID_PROJECT: 未找到 book.json 或 .novelwriter.json 项目标记。请选择有效的完美小说项目文件夹。'
        )
      }

      // R1（Task 10 裁定，T3.5 复审 Out-of-Scope #1 整改）：v2 书但 .novelwriter.json 仍未改名 =
      // migrateBook 最后一步（标记 rename）前崩溃的唯一无歧义中断态（book.json + marker 并存，
      // migrateBook 幂等门允许重入补完）→ 自动续传，报告并入 ProjectData.migration——
      // 否则 Task 3.5 的 resume 语义（复用原始备份、已转文件不重做、id 稳定）永不可从应用到达。
      const interruptedResume = format === 'v2' && hasInterruptedMigration(projectPath)
      let migration: MigrationReport | null = null
      if (format === 'v1' || interruptedResume) {
        migration = migrateBook(projectPath)
        console.warn(
          `[migrate] v1→v2 完成：备份在 ${migration.backupPath}，warnings ${migration.warnings.length} 条`
        )
        for (const w of migration.warnings) {
          console.warn(`[migrate] ${w}`)
        }
      }

      const book = readYamlFile<BookMeta>(bookJsonPath(projectPath))

      // 迁移后自检（open 后跑一次；问题仅记日志，不阻塞打开）
      const problems = validateMigration(projectPath)
      if (problems.length > 0) {
        console.error(`[bookStore] 书目录自检发现 ${problems.length} 处问题（不阻塞）:`)
        for (const p of problems) {
          console.error(`[bookStore] ${p}`)
        }
      }

      // Task 9 裁定 4/8：迁移 + 自检全部完成后才启动监听（v1 迁移的大规模文件改写绝不进 watcher 事件；
      // resume 续迁路径同样先于 watch 完成）；打开另一本书经由 startWatching 的 stop-previous 天然切换
      beginWatching(event, projectPath)

      const projectData: ProjectData = {
        id: book.id, // 稳定书 id（book.json 持久化，跨次打开不变）
        name: book.name,
        path: formatFilePath(projectPath),
        type: book.type,
        createdAt: new Date(),
        updatedAt: new Date(),
        config: book.config,
        migration
      }
      return projectData
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('CORRUPT_BOOK')) {
        // 决不让原始异常作为裸 IPC 错误逃逸：记录后按前缀契约重抛用户可读文案
        console.error('project:open 书籍损坏（fail-closed，书目录未做修改）:', err)
        throw new Error(
          `CORRUPT_BOOK: ${projectPath} — 书籍数据已损坏，未做任何修改，请从 .migration-backup 或备份恢复`
        )
      }
      throw err
    }
  })
}

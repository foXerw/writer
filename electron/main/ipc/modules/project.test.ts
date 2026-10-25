// project.ts handler 级测试：vi.mock('electron') 捕获 ipcMain.handle 注册的 handler 后直接调用，
// 钉住 Task 3.5(e) BOOK_EXISTS 守卫与 Task 3 Step 5 接线（迁移/稳定 id/CORRUPT_BOOK 前缀契约）。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../../tests/tmp'
import { readYamlFile } from '../../bookStore/docStore'
import { bookJsonPath } from '../../bookStore/paths'
import type { BookMeta } from '../../../../src/common/schema'
import type { MigrationReport, ProjectData } from '../../../../src/common/ipc'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ): void => {
      handlers.set(channel, listener)
    }
  }
}))

import { registerProjectHandlers } from './project'

beforeAll(() => {
  registerProjectHandlers()
})

beforeEach(() => {
  // 迁移日志/损坏日志是生产行为，测试输出保持干净
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function getHandler(channel: string): Handler {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn as Handler
}

describe('project:create handler', () => {
  it('建 v2 骨架：返回稳定书 id、migration:null、book.json 落成、不写 v1 标记', async () => {
    const parent = mkTmpBook()

    const data = (await getHandler('project:create')(null, {
      name: '新书',
      path: parent,
      type: 'novel'
    })) as ProjectData
    const dir = join(parent, '新书')

    expect(existsSync(bookJsonPath(dir))).toBe(true)
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(false)
    expect(data.id).toBe(readYamlFile<BookMeta>(bookJsonPath(dir)).id)
    expect(data.migration).toBeNull()
    expect(data.name).toBe('新书')
    expect(data.path).toBe(dir.replace(/\\/g, '/'))
  })

  it('目标已有 book.json → 抛 BOOK_EXISTS: <path>，既有书零字节改动（拒绝静默覆盖）', async () => {
    const parent = mkTmpBook()
    const dir = join(parent, '新书')
    await getHandler('project:create')(null, { name: '新书', path: parent, type: 'novel' })
    const bookBefore = readFileSync(bookJsonPath(dir), 'utf8')

    await expect(
      getHandler('project:create')(null, { name: '新书', path: parent, type: 'novel' })
    ).rejects.toThrow(`BOOK_EXISTS: ${dir}`)
    expect(readFileSync(bookJsonPath(dir), 'utf8')).toBe(bookBefore)
  })
})

describe('project:open handler', () => {
  function makeV1(dir: string): void {
    writeFileSync(
      join(dir, '.novelwriter.json'),
      JSON.stringify({
        name: '旧书',
        type: 'novel',
        version: '1.0.0',
        settings: { wordCountGoal: 0, dailyGoal: 2000, autoSave: true, autoSaveInterval: 30000 }
      }),
      'utf8'
    )
    mkdirSync(join(dir, 'chapters'), { recursive: true })
    writeFileSync(join(dir, 'chapters', '001-黎明.md'), '# 黎明\n\n正文\n', 'utf8')
  }

  it('v1 书自动迁移：返回 migration 报告；重开 id 不变（稳定书 id）且 migration:null', async () => {
    const dir = mkTmpBook()
    makeV1(dir)

    const first = (await getHandler('project:open')(null, dir)) as ProjectData
    expect(first.migration).not.toBeNull()
    const report = first.migration as MigrationReport
    expect(existsSync(report.backupPath)).toBe(true)
    expect(existsSync(join(dir, '.novelwriter.json.migrated'))).toBe(true)
    expect(first.id).toBe(readYamlFile<BookMeta>(bookJsonPath(dir)).id)
    expect(first.name).toBe('旧书')

    const second = (await getHandler('project:open')(null, dir)) as ProjectData
    expect(second.id).toBe(first.id)
    expect(second.migration).toBeNull()
  })

  it('无项目标记目录 → INVALID_PROJECT 前缀（渲染层既有文案链路）', async () => {
    await expect(getHandler('project:open')(null, mkTmpBook())).rejects.toThrow('INVALID_PROJECT')
  })

  it('book.json 损坏 → CORRUPT_BOOK 前缀 + 用户可读文案（裸异常不逃逸）', async () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), 'formatVersion: 1', 'utf8')

    await expect(getHandler('project:open')(null, dir)).rejects.toThrow(
      `CORRUPT_BOOK: ${dir} — 书籍数据已损坏，未做任何修改，请从 .migration-backup 或备份恢复`
    )
  })
})

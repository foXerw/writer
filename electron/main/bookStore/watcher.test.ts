// watcher.ts node 侧测试（Task 9）：真实 tmp 书目录 + 真实 fs.watch（Windows recursive watch 原生支持）。
// 钉死裁定 2/3 的行为契约：
// - debounce 合并：3 次快速外部写 → 一次 book:changed 带 3 条路径；对应域缓存失效的证明 =
//   事件后 repo list 立即见到外部新内容（行为断言，不 spy 内部实现——裁定 2 测试口径）；
// - 过滤：`.tmp-` 原子写残留 / book.json / .migration-backup / 未知路径 / 裸目录名 → 不发任何事件；
// - 错误策略：watcher 'error' 或 fs.watch 同步抛 → 1s 退避重启至多 3 次 → console.error 放弃，绝不抛穿
//   （这两例经 node:fs.watch 注入假 watcher + fake timers；其余各例走真实 fs.watch + 真实时间，超时放宽）；
// - stopWatching：关句柄、清 pending debounce、五域缓存全部失效（重开永不见陈旧）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../tests/tmp'
import { serializeChapterDoc } from '../../../src/common/chapterDoc'
import type { BookChangedEvent } from '../../../src/common/ipc'
import type { ForeshadowEntry } from '../../../src/common/schema'
import { startWatching, stopWatching, type WatcherWindow } from './watcher'
import {
  characterFile,
  chaptersDir,
  domainOf,
  foreshadowFile,
  volumeFile,
  worldEntryFile
} from './paths'
import { writeYamlFileAtomic } from './docStore'
import { createChapter, deleteChapter, listChapters, updateChapter } from './chapters'
import { createVolume, listVolumes } from './volumes'
import { createCharacter, listCharacters } from './characters'
import { createWorldEntry, listWorldEntries } from './world'
import { readLedger, upsertForeshadow } from './narrative'

// ---------------------------------------------------------------------------
// node:fs.watch 可控注入（override=null 时透传真实 fs.watch——绝大多数用例走真实监听）
// ---------------------------------------------------------------------------

const watchControl = vi.hoisted(() => ({
  override: null as null | ((...args: unknown[]) => unknown)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const realWatch = actual.watch as unknown as (...args: unknown[]) => unknown
  return {
    ...actual,
    watch: (...args: unknown[]): unknown =>
      watchControl.override ? watchControl.override(...args) : realWatch(...args)
  }
})

/** 假 FSWatcher：只实现 watcher.ts 用到的 close() + 'error' 事件。 */
class FakeWatcher extends EventEmitter {
  closed = false
  close(): void {
    this.closed = true
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** fake win（裁定 2 测试口径）：{ webContents: { send: vi.fn() } }。 */
function fakeWin(): { win: WatcherWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return { win: { webContents: { send } }, send }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询断言直至通过或超时（真实时间——fs.watch 事件到达时刻不可精确预知，超时放宽）。 */
async function waitFor(assertion: () => void, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      assertion()
      return
    } catch (err) {
      if (Date.now() >= deadline) throw err
      await sleep(50)
    }
  }
}

function chapterDoc(id: string, title: string, order: number, body: string): string {
  return serializeChapterDoc({ id, title, volumeId: null, order, status: 'draft' }, body)
}

beforeEach(() => {
  // watcher 的错误/放弃日志是生产行为，测试输出保持干净（错误策略用例另做断言）
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  stopWatching() // 双保险：任何用例失败也不把活句柄带出本文件
  watchControl.override = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// domainOf（裁定 3，纯函数）
// ---------------------------------------------------------------------------

describe('domainOf：相对路径 → 缓存域（裁定 3）', () => {
  it('五个域的目录前缀 + narrative 的三个入口', () => {
    expect(domainOf('chapters/a.md')).toBe('chapters')
    expect(domainOf('characters/a.yaml')).toBe('characters')
    expect(domainOf('world/location/a.yaml')).toBe('world')
    expect(domainOf('volumes/a.yaml')).toBe('volumes')
    expect(domainOf('foreshadow.yaml')).toBe('narrative')
    expect(domainOf('plotlines/a.yaml')).toBe('narrative')
    expect(domainOf('choices/a.yaml')).toBe('narrative')
  })

  it('book.json / 备份目录 / 未知路径 / 裸目录名 → null；反斜杠归一、尾斜杠剥除', () => {
    expect(domainOf('book.json')).toBeNull() // 配置变更不失效实体域
    expect(domainOf('.migration-backup/2020-01-01T00-00-00/chapters/a.md')).toBeNull()
    expect(domainOf('notes.txt')).toBeNull()
    expect(domainOf('chapters')).toBeNull() // 目录 mtime 事件：域归属只认文件路径
    expect(domainOf('chapters/')).toBeNull()
    expect(domainOf('chapters\\a.md')).toBe('chapters') // Windows 反斜杠归一
  })
})

// ---------------------------------------------------------------------------
// debounce 合并 + 分域失效（真实 fs.watch）
// ---------------------------------------------------------------------------

describe('debounce 合并 + 分域缓存失效（真实 fs.watch，真实时间）', () => {
  it(
    '3 次快速外部写 → 一次 book:changed 带 3 条路径；随后 repo list 见到外部新内容（失效已发生）',
    async () => {
      const p = mkTmpBook()
      mkdirSync(chaptersDir(p), { recursive: true })
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      ids.forEach((id, i) => {
        writeFileSync(
          join(chaptersDir(p), `${id}.md`),
          chapterDoc(id, `旧题${i}`, i + 1, `旧正文${i}\n`),
          'utf8'
        )
      })

      // 预热缓存：list 读到旧值并缓存——外部改动必须经 watcher 失效才可见
      expect(listChapters(p).map((c) => c.title)).toEqual(['旧题0', '旧题1', '旧题2'])

      const { win, send } = fakeWin()
      startWatching(p, win)
      await sleep(200) // 句柄起稳（Windows recursive watch 就绪前的事件不保证送达）

      // 覆盖写三个既有文件（绕仓库直写；不新建文件 → 无目录 mtime 事件干扰路径集合）
      ids.forEach((id, i) => {
        writeFileSync(
          join(chaptersDir(p), `${id}.md`),
          chapterDoc(id, `新题${i}`, i + 1, `新正文${i}\n`),
          'utf8'
        )
      })

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      expect(send.mock.calls[0][0]).toBe('book:changed')
      const payload = send.mock.calls[0][1] as BookChangedEvent
      expect([...payload.paths].sort()).toEqual(
        ids.map((id) => `chapters/${id}.md`).sort()
      )

      // 失效证明（行为断言，不 spy 内部）：事件已发 → chapters 域缓存已清 → list 见外部新内容
      expect(listChapters(p).map((c) => c.title)).toEqual(['新题0', '新题1', '新题2'])
      expect(listChapters(p).map((c) => c.content)).toEqual(['新正文0\n', '新正文1\n', '新正文2\n'])

      // 再观察一个 debounce 窗口以上：3 写恰好合并成 1 事件，无后续补发
      await sleep(700)
      expect(send).toHaveBeenCalledTimes(1)
    },
    20_000
  )

  it(
    '.tmp- 残留 / book.json / .migration-backup / 未知路径 → 全部过滤，不发任何事件',
    async () => {
      const p = mkTmpBook()
      mkdirSync(chaptersDir(p), { recursive: true })
      const { win, send } = fakeWin()
      startWatching(p, win)
      await sleep(200)

      // 原子写残留（docStore 的 <name>.tmp-<uuid> 形状，落在 chapters/ 内）
      writeFileSync(join(chaptersDir(p), `${randomUUID()}.md.tmp-${randomUUID()}`), '残留', 'utf8')
      // book.json：配置变更不失效实体域（裁定 3）
      writeFileSync(join(p, 'book.json'), 'id: x\n', 'utf8')
      // 迁移备份目录（裁定 2：.migration-backup churn 必须被杀）
      mkdirSync(join(p, '.migration-backup', '2020-01-01T00-00-00'), { recursive: true })
      writeFileSync(join(p, '.migration-backup', '2020-01-01T00-00-00', 'old.md'), '旧档', 'utf8')
      // 书根下的未知散落文件
      writeFileSync(join(p, 'notes.txt'), '随手记', 'utf8')

      await sleep(1200) // 远超 300ms debounce：任何漏过滤的路径都已成事件
      expect(send).not.toHaveBeenCalled()
    },
    20_000
  )
})

// ---------------------------------------------------------------------------
// 自写抑制（修订轮2 I1）：仓库自写/自删 ~1s 窗口内不进广播；失效仍按全集执行
// ---------------------------------------------------------------------------

describe('自写抑制（I1：确定性自回声从源头静音）', () => {
  it(
    'rename-while-dirty 序列：仓库自写不进 book:changed，并发外部写照常进；缓存失效仍按全集执行',
    async () => {
      const p = mkTmpBook()
      mkdirSync(chaptersDir(p), { recursive: true })
      const mine = randomUUID()
      const foreign = randomUUID()
      // 自章 body 带 H1 首行：rename 的 H1 同步会改 body——I1 病理（disk≠lastSaved 假冲突）的精确复现
      writeFileSync(join(chaptersDir(p), `${mine}.md`), chapterDoc(mine, '自章', 1, '# 自章\n\n我的。\n'), 'utf8')
      writeFileSync(join(chaptersDir(p), `${foreign}.md`), chapterDoc(foreign, '他章', 2, '他的。\n'), 'utf8')
      // 预热缓存（旧值）——flush 后两者都必须见新值：失效不因「广播剔除自写路径」而豁免
      expect(listChapters(p).map((c) => c.title)).toEqual(['自章', '他章'])

      const { win, send } = fakeWin()
      startWatching(p, win)
      await sleep(200)

      // 模拟「脏章 rename」：仓库写（title 变化 → H1 同步改 body → 旧实现里 disk≠lastSaved 的假冲突源）
      updateChapter(p, mine, { title: '自章改名' })
      // 同一 debounce 窗口内的真外部写
      writeFileSync(
        join(chaptersDir(p), `${foreign}.md`),
        chapterDoc(foreign, '他章外部', 2, '外部他的。\n'),
        'utf8'
      )

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      const payload = send.mock.calls[0][1] as BookChangedEvent
      // 自写路径被剔除（渲染层不会再对它做冲突判定），外部路径保留
      expect(payload.paths).toEqual([`chapters/${foreign}.md`])
      // 失效按全集执行（cache==磁盘真相）：两者新值都立即可见
      expect(listChapters(p).map((c) => c.title)).toEqual(['自章改名', '他章外部'])
      expect(listChapters(p).map((c) => c.content)).toEqual(['# 自章改名\n\n我的。\n', '外部他的。\n'])
    },
    20_000
  )

  it(
    '纯自写/自删批次 → 不发任何 book:changed（零渲染层抖动）',
    async () => {
      const p = mkTmpBook()
      const c = createChapter(p, '静默章')
      const { win, send } = fakeWin()
      startWatching(p, win)
      await sleep(200)

      updateChapter(p, c.id, { content: '自动保存写盘的新内容。\n' }) // 模拟自动保存（写）
      deleteChapter(p, c.id) // 模拟树上删章（删——unlink 同样登记）

      await sleep(1200) // 远超 debounce：任何漏抑制的自回声都已成事件
      expect(send).not.toHaveBeenCalled()
    },
    20_000
  )
})

// ---------------------------------------------------------------------------
// 错误 → 重启 → 放弃（假 watcher 注入 + fake timers）
// ---------------------------------------------------------------------------

describe('错误策略：1s 退避重启 ×3 → console.error 放弃，绝不抛穿', () => {
  it("watcher 'error' 事件 → 重启 3 次后放弃（应用不崩，句柄可安全 stop）", () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const instances: FakeWatcher[] = []
    watchControl.override = () => {
      const w = new FakeWatcher()
      instances.push(w)
      return w
    }
    const { win } = fakeWin()

    expect(() => startWatching('/nonexistent-book-root', win)).not.toThrow()
    expect(instances).toHaveLength(1)

    // 前三次 error → 各 1s 退避后重启
    for (let i = 0; i < 3; i++) {
      expect(() => instances[i].emit('error', new Error(`EPERM-${i}`))).not.toThrow()
      expect(instances[i].closed).toBe(true) // 死句柄先关
      vi.advanceTimersByTime(999)
      expect(instances).toHaveLength(i + 1) // 退避未满：还没重启
      vi.advanceTimersByTime(1)
      expect(instances).toHaveLength(i + 2) // 满 1s：重启完成
    }

    // 第 4 次 error：重启预算耗尽 → console.error 放弃，不再新建句柄、不抛
    expect(() => instances[3].emit('error', new Error('EPERM-3'))).not.toThrow()
    vi.advanceTimersByTime(60_000)
    expect(instances).toHaveLength(4)
    expect(
      errorSpy.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('放弃'))
    ).toBe(true)
    expect(() => stopWatching()).not.toThrow() // 放弃后的收尾同样安全
  })

  it('fs.watch 同步抛（目录被删等）→ 同走重启预算，主进程绝不崩', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempts = 0
    watchControl.override = () => {
      attempts += 1
      throw new Error('ENOENT: no such file or directory')
    }
    const { win } = fakeWin()

    expect(() => startWatching('/gone', win)).not.toThrow()
    expect(attempts).toBe(1)
    vi.advanceTimersByTime(10_000) // 3 次退避重启全在同一窗口内烧完 → 放弃
    expect(attempts).toBe(4) // 初始 1 + 重启 3
    expect(() => stopWatching()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// stopWatching：五域缓存全部失效
// ---------------------------------------------------------------------------

describe('stopWatching', () => {
  it('关闭监听 + 清 pending debounce + 五域缓存全部失效（重开永不见陈旧）', () => {
    const p = mkTmpBook()
    const now = new Date().toISOString()

    // 五域各建一份真实数据（经仓库 mutation 写盘）
    const ch = createChapter(p, '原题章')
    const vol = createVolume(p, '原题卷')
    const car = createCharacter(p, { name: '原人', gender: 'male', role: 'supporting' })
    const wor = createWorldEntry(p, { title: '原词条', category: 'location' })
    const entry: ForeshadowEntry = {
      id: randomUUID(),
      title: '原伏笔',
      plantedChapterId: ch.id,
      plannedPayoffNote: '',
      resolvedChapterId: null,
      status: 'open'
    }
    upsertForeshadow(p, entry)

    // 预热五域缓存
    expect(listChapters(p)[0].title).toBe('原题章')
    expect(listVolumes(p)[0].title).toBe('原题卷')
    expect(listCharacters(p)[0].name).toBe('原人')
    expect(listWorldEntries(p)[0].title).toBe('原词条')
    expect(readLedger(p).entries[0].title).toBe('原伏笔')

    const { win, send } = fakeWin()
    startWatching(p, win)

    // 五域绕过仓库直写新内容（外部编辑器模拟）
    writeFileSync(
      join(chaptersDir(p), `${ch.id}.md`),
      chapterDoc(ch.id, '外改章', 1, '外部正文。\n'),
      'utf8'
    )
    writeYamlFileAtomic(volumeFile(p, vol.id), { id: vol.id, title: '外改卷', order: vol.order })
    writeYamlFileAtomic(characterFile(p, car.id), { ...car, name: '外改人', updatedAt: now })
    writeYamlFileAtomic(worldEntryFile(p, 'location', wor.id), {
      ...wor,
      title: '外改词条',
      updatedAt: now
    })
    writeYamlFileAtomic(foreshadowFile(p), { entries: [{ ...entry, title: '外改伏笔' }] })

    // 直写后、stop 前：缓存权威——依旧值（证明下面的「新值」只能来自 stopWatching 的全域失效）
    expect(listChapters(p)[0].title).toBe('原题章')
    expect(listVolumes(p)[0].title).toBe('原题卷')
    expect(listCharacters(p)[0].name).toBe('原人')
    expect(listWorldEntries(p)[0].title).toBe('原词条')
    expect(readLedger(p).entries[0].title).toBe('原伏笔')

    stopWatching() // 同步：关句柄 + 清 pending（debounce 未满，事件永不发出）+ 五域失效

    expect(listChapters(p)[0].title).toBe('外改章')
    expect(listVolumes(p)[0].title).toBe('外改卷')
    expect(listCharacters(p)[0].name).toBe('外改人')
    expect(listWorldEntries(p)[0].title).toBe('外改词条')
    expect(readLedger(p).entries[0].title).toBe('外改伏笔')
    expect(send).not.toHaveBeenCalled() // pending 已清：stop 前的事件不再广播
  })

  it('未监听时为无害 no-op（重复 stop / 从未 start 都不抛）', () => {
    expect(() => stopWatching()).not.toThrow()
    expect(() => stopWatching()).not.toThrow()
  })
})

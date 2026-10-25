// narrative:* handler 级测试（Task 8）：vi.mock('electron') 捕获注册后直接调用，
// 钉死 13 通道的薄委托 + 参数形状 {projectPath, plotline|choice|entry|...}——
// 错误语义（REF_BROKEN / FORESHADOW_TRANSITION）原样透传到通道外；delete 幂等 false。
// 状态机行为本身在 bookStore/narrative.test.ts 全边钉死，这里只测委托与形状。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkTmpBook } from '../../../../tests/tmp'
import { randomUUID } from 'node:crypto'
import type {
  ChoiceNodeV2,
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineV2
} from '../../../../src/common/schema'
import { createChapter } from '../../bookStore/chapters'

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

import { registerNarrativeHandlers } from './narrative'

beforeAll(() => {
  registerNarrativeHandlers()
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

function mkEntry(over?: Partial<ForeshadowEntry>): ForeshadowEntry {
  return {
    id: randomUUID(),
    title: '旧钟',
    plantedChapterId: randomUUID(),
    plannedPayoffNote: '',
    resolvedChapterId: null,
    status: 'open',
    ...over
  }
}

describe('plotline:* / choice:* handlers 委托', () => {
  it('plotline create→getAll→update→delete 全链路走 v2 仓库语义', async () => {
    const p = mkTmpBook()
    const pl = (await getHandler('plotline:create')(null, {
      projectPath: p,
      plotline: { title: '主线', summary: '少年离乡', stages: [] }
    })) as PlotlineV2
    expect(pl.status).toBe('active')
    const list = (await getHandler('plotline:getAll')(null, p)) as PlotlineV2[]
    expect(list.map((x) => x.id)).toEqual([pl.id])
    const next = (await getHandler('plotline:update')(null, {
      projectPath: p,
      plotline: { ...pl, title: '改名线' }
    })) as PlotlineV2
    expect(next.title).toBe('改名线')
    expect(next.createdAt).toBe(pl.createdAt)
    expect(await getHandler('plotline:delete')(null, { projectPath: p, plotlineId: pl.id })).toBe(true)
    expect(
      await getHandler('plotline:delete')(null, { projectPath: p, plotlineId: '../../evil' })
    ).toBe(false)
  })

  it('choice 挂章：真实章放行、幻影章 REF_BROKEN 原样透传且磁盘未动', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const c = (await getHandler('choice:create')(null, {
      projectPath: p,
      choice: { title: '过桥还是绕路', chapterId: ch.id, options: [{ label: '过桥', consequence: '遇伏' }] }
    })) as ChoiceNodeV2
    expect(c.options).toHaveLength(1)
    const ghost = randomUUID()
    await expect(
      Promise.resolve().then(() =>
        getHandler('choice:create')(null, { projectPath: p, choice: { title: '幻影', chapterId: ghost } })
      )
    ).rejects.toThrow(`REF_BROKEN: ${ghost}`)
    const list = (await getHandler('choice:getAll')(null, p)) as ChoiceNodeV2[]
    expect(list.map((x) => x.id)).toEqual([c.id]) // 坏 create 零落盘
    expect(await getHandler('choice:delete')(null, { projectPath: p, choiceId: c.id })).toBe(true)
  })
})

describe('foreshadow:* handlers 委托', () => {
  it('get（缺失=EMPTY）→upsert→resolve→abandon→reopen 通道形状与状态透传', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '回收章')
    expect(await getHandler('foreshadow:get')(null, p)).toEqual({ entries: [] })
    const e = mkEntry()
    const led = (await getHandler('foreshadow:upsert')(null, { projectPath: p, entry: e })) as ForeshadowLedger
    expect(led.entries).toEqual([e])
    const done = (await getHandler('foreshadow:resolve')(null, {
      projectPath: p,
      foreshadowId: e.id,
      resolvedChapterId: ch.id
    })) as ForeshadowLedger
    expect(done.entries[0].status).toBe('resolved')
    expect(done.entries[0].resolvedChapterId).toBe(ch.id)
    // resolved→abandoned 非法：通道外仍是 FORESHADOW_TRANSITION: <id>
    await expect(
      Promise.resolve().then(() =>
        getHandler('foreshadow:abandon')(null, { projectPath: p, foreshadowId: e.id })
      )
    ).rejects.toThrow(`FORESHADOW_TRANSITION: ${e.id}`)
    const back = (await getHandler('foreshadow:reopen')(null, {
      projectPath: p,
      foreshadowId: e.id
    })) as ForeshadowLedger
    expect(back.entries[0].status).toBe('open')
    expect(back.entries[0].resolvedChapterId).toBeNull()
  })

  it('resolve 携幻影章 → REF_BROKEN 透传且台账字节不动', async () => {
    const p = mkTmpBook()
    const e = mkEntry()
    await getHandler('foreshadow:upsert')(null, { projectPath: p, entry: e })
    const ghost = randomUUID()
    await expect(
      Promise.resolve().then(() =>
        getHandler('foreshadow:resolve')(null, { projectPath: p, foreshadowId: e.id, resolvedChapterId: ghost })
      )
    ).rejects.toThrow(`REF_BROKEN: ${ghost}`)
    const led = (await getHandler('foreshadow:get')(null, p)) as ForeshadowLedger
    expect(led.entries[0].status).toBe('open')
  })
})

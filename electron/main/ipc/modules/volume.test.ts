// volume:* + chapter:moveToVolume handler 级测试（Task 5）：vi.mock('electron') 捕获注册后直接调用，
// 钉死「6 通道薄委托 + 参数形状 {projectPath, ...}」——volumeId 缺省归一为 null（回未分卷）。
// 错误语义透传：VOLUME_MISSING / BAD_VOLUME_ID 原样抛到通道外。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkTmpBook } from '../../../../tests/tmp'
import type { Chapter, Volume } from '../../../../src/common/ipc'
import { createChapter, getChapter } from '../../bookStore/chapters'
import { UUID_PATTERN } from '../../../../src/common/schema'

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

import { registerVolumeHandlers } from './volume'

beforeAll(() => {
  registerVolumeHandlers()
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

describe('volume:* handlers 委托', () => {
  it('create→getAll→rename→reorder→delete 全链路走 v2 卷仓库语义', async () => {
    const p = mkTmpBook()
    const a = (await getHandler('volume:create')(null, { projectPath: p, title: '第一卷' })) as Volume
    const b = (await getHandler('volume:create')(null, { projectPath: p, title: '第二卷' })) as Volume
    expect(a.id).toMatch(UUID_PATTERN)
    expect(b.order).toBe(2)

    let list = (await getHandler('volume:getAll')(null, p)) as Volume[]
    expect(list.map((v) => v.title)).toEqual(['第一卷', '第二卷'])

    const renamed = (await getHandler('volume:rename')(null, {
      projectPath: p,
      volumeId: a.id,
      newTitle: '改名卷'
    })) as Volume
    expect(renamed.title).toBe('改名卷')

    expect(
      await getHandler('volume:reorder')(null, { projectPath: p, fromId: b.id, toId: a.id })
    ).toBe(true)
    list = (await getHandler('volume:getAll')(null, p)) as Volume[]
    expect(list.map((v) => v.id)).toEqual([b.id, a.id])
    expect(list.map((v) => v.order)).toEqual([1, 2])

    expect(await getHandler('volume:delete')(null, { projectPath: p, volumeId: a.id })).toBe(true)
    list = (await getHandler('volume:getAll')(null, p)) as Volume[]
    expect(list.map((v) => v.id)).toEqual([b.id])
  })

  it('chapter:moveToVolume：入卷→回未分卷；volumeId 缺省视同 null', async () => {
    const p = mkTmpBook()
    const vol = (await getHandler('volume:create')(null, {
      projectPath: p,
      title: '目标卷'
    })) as Volume
    const ch = createChapter(p, '章')

    const moved = (await getHandler('chapter:moveToVolume')(null, {
      projectPath: p,
      chapterId: ch.id,
      volumeId: vol.id
    })) as Chapter
    expect(moved.volumeId).toBe(vol.id)

    // volumeId 缺省（渲染层忘传）→ 归一 null = 未分卷，绝不视同「不改归属」
    const unassigned = (await getHandler('chapter:moveToVolume')(null, {
      projectPath: p,
      chapterId: ch.id
    })) as Chapter
    expect(unassigned.volumeId).toBeNull()
    expect(getChapter(p, ch.id)!.volumeId).toBeNull()
  })

  it('坏形状卷 id：moveToVolume 抛 BAD_VOLUME_ID；delete 按幂等契约返回 false', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '章')
    await expect(
      Promise.resolve().then(() =>
        getHandler('chapter:moveToVolume')(null, {
          projectPath: p,
          chapterId: ch.id,
          volumeId: '../../evil'
        })
      )
    ).rejects.toThrow('BAD_VOLUME_ID: ../../evil')
    expect(await getHandler('volume:delete')(null, { projectPath: p, volumeId: '../evil' })).toBe(
      false
    )
  })
})

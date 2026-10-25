// chapter:* handler 级测试（Task 4）：vi.mock('electron') 捕获注册后直接调用，
// 钉死「7 通道薄委托 + 形状不变」——尤其 reorder 的 (fromId,toId)→toId.order 映射与
// update 对整 Chapter 对象的 patch 抽取（这是瞬态窗口关闭的 IPC 侧证明）。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkTmpBook } from '../../../../tests/tmp'
import type { Chapter } from '../../../../src/common/ipc'
import { createChapter, getChapter } from '../../bookStore/chapters'
import { createVolume, moveChapterToVolume } from '../../bookStore/volumes'

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

import { registerChapterHandlers } from './chapter'

beforeAll(() => {
  registerChapterHandlers()
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

describe('chapter:* handlers 委托', () => {
  it('create→getAll→update→rename→delete 全链路走 v2 仓库语义', async () => {
    const p = mkTmpBook()
    const created = (await getHandler('chapter:create')(null, {
      projectPath: p,
      title: '第一章'
    })) as Chapter
    expect(created.order).toBe(1)

    const list = (await getHandler('chapter:getAll')(null, p)) as Chapter[]
    expect(list.map((c) => c.title)).toEqual(['第一章'])
    expect(list[0].content).toBe('# 第一章\n\n') // 不含 front-matter

    // 整 Chapter 对象回传（渲染层旧形状，volumeId 缺省）→ 仅改 content+status
    const updated = (await getHandler('chapter:update')(null, {
      projectPath: p,
      chapter: { ...created, status: 'revising', content: '# 第一章\n\n正文。\n' }
    })) as Chapter
    expect(updated.status).toBe('revising')
    expect(updated.volumeId).toBeNull()

    const renamed = (await getHandler('chapter:rename')(null, {
      projectPath: p,
      chapterId: created.id,
      newTitle: '改名章'
    })) as Chapter
    expect(renamed.title).toBe('改名章')
    expect(renamed.content).toBe('# 改名章\n\n正文。\n') // H1 同步裁定

    const byId = (await getHandler('chapter:getById')(null, {
      projectPath: p,
      chapterId: created.id
    })) as Chapter
    expect(byId.title).toBe('改名章')

    expect(
      await getHandler('chapter:delete')(null, { projectPath: p, chapterId: created.id })
    ).toBe(true)
    expect(await getHandler('chapter:getAll')(null, p)).toEqual([])
  })

  it('reorder(fromId,toId)：toId 映射为其当前 order 后移动（v1 语义不变）', async () => {
    const p = mkTmpBook()
    const a = (await getHandler('chapter:create')(null, { projectPath: p, title: '甲' })) as Chapter
    await getHandler('chapter:create')(null, { projectPath: p, title: '乙' })
    const c = (await getHandler('chapter:create')(null, { projectPath: p, title: '丙' })) as Chapter

    expect(
      await getHandler('chapter:reorder')(null, { projectPath: p, fromId: a.id, toId: c.id })
    ).toBe(true)
    const list = (await getHandler('chapter:getAll')(null, p)) as Chapter[]
    expect(list.map((x) => x.title)).toEqual(['乙', '丙', '甲'])
    expect(list.map((x) => x.order)).toEqual([1, 2, 3])

    expect(
      await getHandler('chapter:reorder')(null, { projectPath: p, fromId: a.id, toId: 'ghost' })
    ).toBe(false)
  })

  it('chapter:update 不回写 volumeId（Task 5 评审整改：归属唯一通道 = chapter:moveToVolume）', async () => {
    const p = mkTmpBook()
    const volume = createVolume(p, '真卷')
    const ch = createChapter(p, '归属章')
    moveChapterToVolume(p, ch.id, volume.id) // 磁盘现状：属于真卷

    // 陈旧会话对象（脏 flush 竞态形态）带一个「别的」volumeId 走 update → 磁盘归属纹丝不动
    const stale = { ...getChapter(p, ch.id)!, volumeId: '99999999-8888-4888-8888-777777777777', content: '# 归属章\n\n手改正文。\n' }
    const updated = (await getHandler('chapter:update')(null, { projectPath: p, chapter: stale })) as Chapter
    expect(updated.volumeId).toBe(volume.id)
    expect(getChapter(p, ch.id)!.volumeId).toBe(volume.id)
    expect(getChapter(p, ch.id)!.content).toBe(stale.content) // 正文/标题照常走本通道
  })

  it('update 缺失 id → CHAPTER_MISSING 前缀透传给渲染层', async () => {
    const p = mkTmpBook()
    const ghost = { id: '99999999-8888-4888-8888-777777777777', title: 't', content: 'x' } as Chapter
    // 委托 handler 同步抛（真实 electron 会包装成 rejected invoke——两种形态都钉住）
    await expect(
      Promise.resolve().then(() =>
        getHandler('chapter:update')(null, { projectPath: p, chapter: ghost })
      )
    ).rejects.toThrow('CHAPTER_MISSING: 99999999-8888-4888-8888-777777777777')
  })
})

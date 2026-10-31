// review:* handler 级测试（M6 T1）：vi.mock('electron') 捕获注册后直接调用（proposal.test.ts 同款），
// 钉死 4 通道的薄委托 + 参数形状（全部 {projectPath, …} 对象参数）+ 通道级盖章
// REVIEW_CHAPTER_MISSING（saveRun 目标章必须现存——存储层校验管形状、通道层管归属）。
// 合并矩阵/状态迁移等存储语义在 bookStore/reviews.test.ts 全量钉死，这里不重复。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../../tests/tmp'
import type { ReviewOpinion } from '../../../../src/common/reviewTypes'
import { reviewFile } from '../../bookStore/paths'
import { createChapter } from '../../bookStore/chapters'
import { loadReviews } from '../../bookStore/reviews'

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

import { registerReviewHandlers } from './reviews'

beforeAll(() => {
  registerReviewHandlers()
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

function mkOp(chapterId: string, over: Partial<ReviewOpinion> = {}): ReviewOpinion {
  return {
    id: randomUUID(),
    chapterId,
    category: 'pacing',
    severity: 'soft',
    anchor: { quote: '中段铺排过缓', paraIndex: 2 },
    text: '节奏拖沓。',
    status: 'open',
    stale: false,
    createdAt: new Date().toISOString(),
    model: 'slot-model',
    ...over
  }
}

describe('review:* 四通道注册 + 薄委托', () => {
  it('四通道全部注册（M6 明文许可的唯一新增通道族）', () => {
    for (const ch of ['review:get', 'review:saveRun', 'review:dismiss', 'review:markConverted']) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('review:get 带 chapterId = 单章点读；缺省 = 全书聚合', async () => {
    const p = mkTmpBook()
    const a = createChapter(p, '甲章').id
    const b = createChapter(p, '乙章').id
    const oa = mkOp(a)
    const ob = mkOp(b, { anchor: { quote: '乙章意见', paraIndex: 0 } })
    // model 参数与 oa/ob 自带值一致——saveRun 以参数盖章为单一权威，读回形状才可逐字对等
    await getHandler('review:saveRun')(null, { projectPath: p, chapterId: a, opinions: [oa], model: 'slot-model' })
    await getHandler('review:saveRun')(null, { projectPath: p, chapterId: b, opinions: [ob], model: 'slot-model' })
    expect(await getHandler('review:get')(null, { projectPath: p, chapterId: a })).toEqual([oa])
    const all = (await getHandler('review:get')(null, { projectPath: p })) as ReviewOpinion[]
    expect(all.map((o) => o.id).sort()).toEqual([oa.id, ob.id].sort())
  })

  it('review:saveRun 盖章：目标章不存在 → REVIEW_CHAPTER_MISSING，账本零落盘', async () => {
    const p = mkTmpBook()
    createChapter(p, '第一章')
    const ghost = randomUUID()
    await expect(
      Promise.resolve().then(() =>
        getHandler('review:saveRun')(null, {
          projectPath: p,
          chapterId: ghost,
          opinions: [mkOp(ghost)],
          model: 'm'
        })
      )
    ).rejects.toThrow(`REVIEW_CHAPTER_MISSING: ${ghost}`)
    expect(existsSync(reviewFile(p, ghost))).toBe(false)
  })

  it('review:saveRun 双保险委托：坏形状意见 → REVIEW_INVALID 抛穿（渲染层漏检也拦得住）', async () => {
    const p = mkTmpBook()
    const a = createChapter(p, '第一章').id
    await expect(
      Promise.resolve().then(() =>
        getHandler('review:saveRun')(null, {
          projectPath: p,
          chapterId: a,
          opinions: [mkOp(a, { stale: 'yes' as unknown as boolean })],
          model: 'm'
        })
      )
    ).rejects.toThrow(/REVIEW_INVALID/)
    expect(loadReviews(p, a)).toEqual([])
  })

  it('review:dismiss / review:markConverted 委托返回更新后全集', async () => {
    const p = mkTmpBook()
    const a = createChapter(p, '第一章').id
    const o = mkOp(a)
    await getHandler('review:saveRun')(null, { projectPath: p, chapterId: a, opinions: [o], model: 'm' })
    const afterDismiss = (await getHandler('review:dismiss')(null, {
      projectPath: p,
      chapterId: a,
      opinionId: o.id
    })) as ReviewOpinion[]
    expect(afterDismiss[0].status).toBe('dismissed')
    const conv = mkOp(a, { anchor: { quote: '另一处问题', paraIndex: 5 } })
    await getHandler('review:saveRun')(null, { projectPath: p, chapterId: a, opinions: [conv], model: 'm' })
    const afterConv = (await getHandler('review:markConverted')(null, {
      projectPath: p,
      chapterId: a,
      opinionId: conv.id,
      proposalId: 'prop-xyz-1'
    })) as ReviewOpinion[]
    const stored = afterConv.find((x) => x.id === conv.id)
    expect(stored?.status).toBe('converted')
    expect(stored?.proposalId).toBe('prop-xyz-1')
  })
})

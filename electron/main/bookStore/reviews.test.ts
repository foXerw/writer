// M6 T1——reviews 仓库测试（`.ai/reviews/<chapterId>.json` 单文件 JSON 数组，缩进 2 人可读）。
// 钉死：缺文件=[]、文件形态、saveRun 合并矩阵四路（dismissed/converted 保留、旧 open 重现被替换、
// 旧 open 未重现标 stale、新意见命中 dismissed 抑制键被丢）、部分写零污染（校验全量前置，
// 任一条坏 → 抛穿且旧档字节原封不动）、宽容读（坏档 warn+[]、坏条目 warn+skip）、
// dismiss/markConverted 状态迁移守卫、chapterId UUID 路径安全门。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import type { ReviewOpinion } from '../../../src/common/reviewTypes'
import { reviewFile, reviewsDir } from './paths'
import { createChapter } from './chapters'
import { dismissReview, listAllReviews, loadReviews, markReviewConverted, saveRun } from './reviews'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const MODEL = 'glm-review-slot'

/** 合法意见工厂（id 缺省随机；spread 覆盖造变体）。 */
function mkOp(chapterId: string, over: Partial<ReviewOpinion> = {}): ReviewOpinion {
  return {
    id: randomUUID(),
    chapterId,
    category: 'pacing',
    severity: 'soft',
    anchor: { quote: '中段铺排过缓，天气描写三连', paraIndex: 4 },
    text: '节奏拖沓。',
    status: 'open',
    stale: false,
    createdAt: new Date().toISOString(),
    model: MODEL,
    ...over
  }
}

describe('loadReviews：缺文件=[]；文件形态 = 缩进 2 的人可读 JSON 数组', () => {
  it('从未审过的章 → []', () => {
    const p = mkTmpBook()
    expect(loadReviews(p, randomUUID())).toEqual([])
  })

  it('saveRun 落盘 .ai/reviews/<chapterId>.json，JSON.parse 回读一致且缩进 2 可读', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const o = mkOp(ch.id)
    saveRun(p, ch.id, [o], MODEL)
    const abs = reviewFile(p, ch.id)
    expect(existsSync(abs)).toBe(true)
    const raw = readFileSync(abs, 'utf8')
    expect(raw).toContain('\n  {') // 缩进 2（人可读，同 BOOK_FORMAT §7 派生数据待遇）
    expect(raw).not.toContain('\t')
    expect(JSON.parse(raw) as ReviewOpinion[]).toEqual([o])
  })

  it('坏 JSON 字节 → warn + []（读侧容错，一本坏档不瘫痪面板）', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    mkdirSync(reviewsDir(p), { recursive: true })
    writeFileSync(reviewFile(p, ch.id), '{ not json', 'utf8')
    expect(loadReviews(p, ch.id)).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })

  it('数组内坏条目 warn + skip，好条目保留（逐条 validateReviewOpinion）', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const good = mkOp(ch.id)
    mkdirSync(reviewsDir(p), { recursive: true })
    writeFileSync(
      reviewFile(p, ch.id),
      JSON.stringify([good, { id: 'x', chapterId: 'not-a-uuid' }], null, 2),
      'utf8'
    )
    expect(loadReviews(p, ch.id)).toEqual([good])
    expect(console.warn).toHaveBeenCalled()
  })

  it('chapterId 非 UUID（../evil 等）→ BAD_REVIEW_CHAPTER_ID 抛（join 重定向封死）', () => {
    const p = mkTmpBook()
    expect(() => loadReviews(p, '../evil')).toThrow(/BAD_REVIEW_CHAPTER_ID/)
    expect(() => loadReviews(p, 'x'.repeat(8))).toThrow(/BAD_REVIEW_CHAPTER_ID/)
  })
})

describe('saveRun：合并矩阵四路（spec Q4 + G4 重审替换/驳回抑制）', () => {
  function twoChapterIds() {
    const p = mkTmpBook()
    const a = createChapter(p, '甲章')
    const b = createChapter(p, '乙章')
    return { p, a: a.id, b: b.id }
  }

  it('路1+路2：旧 dismissed 保留；新意见命中其抑制键 → 被丢弃（防复读）', () => {
    const { p, a } = twoChapterIds()
    const first = mkOp(a, { anchor: { quote: '中段铺排过缓', paraIndex: 1 } })
    saveRun(p, a, [first], MODEL)
    dismissReview(p, a, first.id)
    // 重审：模型复读同一处（新 id、空白/全角变体引文、段号漂移）
    const rerun = mkOp(a, { anchor: { quote: ' 中段铺排过缓 ', paraIndex: 7 } })
    const merged = saveRun(p, a, [rerun], MODEL)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(first.id)
    expect(merged[0].status).toBe('dismissed')
  })

  it('路2：新意见与旧 dismissed 同类别不同引文 → 不受抑制，正常入档', () => {
    const { p, a } = twoChapterIds()
    const first = mkOp(a, { anchor: { quote: '中段铺排过缓', paraIndex: 1 } })
    saveRun(p, a, [first], MODEL)
    dismissReview(p, a, first.id)
    const other = mkOp(a, { anchor: { quote: '结尾收得太急', paraIndex: 9 } })
    const merged = saveRun(p, a, [other], MODEL)
    expect(merged.map((o) => o.id).sort()).toEqual([first.id, other.id].sort())
  })

  it('路3：旧 open 与新同抑制键 → 被新替换（旧 id 出局，新条目 open/stale=false）', () => {
    const { p, a } = twoChapterIds()
    const old = mkOp(a, { anchor: { quote: '中段铺排过缓', paraIndex: 1 } })
    saveRun(p, a, [old], MODEL)
    const fresh = mkOp(a, { anchor: { quote: '中段 铺排过缓', paraIndex: 1 } })
    const merged = saveRun(p, a, [fresh], MODEL)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(fresh.id)
    expect(merged[0].status).toBe('open')
    expect(merged[0].stale).toBe(false)
  })

  it('路4：旧 open 未重现 → 保留且 stale=true（「上次未重现」非删除）；二次未重现仍 stale', () => {
    const { p, a } = twoChapterIds()
    const v1 = mkOp(a, { anchor: { quote: '天气描写三连', paraIndex: 2 } })
    saveRun(p, a, [v1], MODEL)
    const v2 = mkOp(a, { anchor: { quote: '对话比例失衡', paraIndex: 3 } })
    const after2 = saveRun(p, a, [v2], MODEL)
    const staleOne = after2.find((o) => o.id === v1.id)
    expect(staleOne).toBeDefined()
    expect(staleOne?.status).toBe('open')
    expect(staleOne?.stale).toBe(true)
    // 第三轮：v2 消失、stale 的 v1 仍未重现 → stale 保持 true（幂等，不叠加不删除）
    const v3 = mkOp(a, { anchor: { quote: '转场生硬', paraIndex: 4 } })
    const after3 = saveRun(p, a, [v3], MODEL)
    expect(after3.find((o) => o.id === v1.id)?.stale).toBe(true)
    expect(after3.find((o) => o.id === v2.id)?.stale).toBe(true)
  })

  it('旧 stale open 在新 run 重现 → 被新替换（恢复新鲜 open）', () => {
    const { p, a } = twoChapterIds()
    const v1 = mkOp(a, { anchor: { quote: '天气描写三连', paraIndex: 2 } })
    saveRun(p, a, [v1], MODEL)
    saveRun(p, a, [mkOp(a, { anchor: { quote: '无关引文', paraIndex: 0 } })], MODEL) // v1 转 stale
    const again = mkOp(a, { anchor: { quote: '天气描写三连', paraIndex: 2 } })
    const merged = saveRun(p, a, [again], MODEL)
    expect(merged.find((o) => o.id === v1.id)).toBeUndefined()
    const hit = merged.find((o) => o.id === again.id)
    expect(hit?.stale).toBe(false)
  })

  it('newKeys 取自抑制后 additions：dismissed 新条目被抑制丢弃 → 不得顺手替换旧 open（防静默消失）', () => {
    // 理论边界（T1 评审发现①）：同键 dismissed 新条目被 dismissedKeys 抑制（不入 additions），
    // 若 newKeys 取自全量 incoming，旧 open 仍会被这条「永远不会入档」的意见替换——双向出局，
    // 意见静默消失。修复后 newKeys 只看真正入档的 additions：旧 open 保留并标 stale。
    const { p, a } = twoChapterIds()
    const openOld = mkOp(a, { anchor: { quote: '天气描写三连', paraIndex: 2 } })
    const dismissedSame = mkOp(a, { anchor: { quote: '天气描写三连', paraIndex: 5 }, status: 'dismissed' })
    saveRun(p, a, [openOld, dismissedSame], MODEL)
    const rerun = mkOp(a, {
      anchor: { quote: ' 天气描写三连 ', paraIndex: 0 }, // 归一化后同键
      status: 'dismissed'
    })
    const merged = saveRun(p, a, [rerun], MODEL)
    const keptOpen = merged.find((o) => o.id === openOld.id)
    expect(keptOpen?.status).toBe('open') // 没被一条不入档的意见顶掉
    expect(keptOpen?.stale).toBe(true) // 本轮未入档 → 按「未重现」标 stale
    expect(merged.find((o) => o.id === dismissedSame.id)?.status).toBe('dismissed')
    expect(merged.find((o) => o.id === rerun.id)).toBeUndefined() // 抑制照常生效
    expect(loadReviews(p, a)).toEqual(merged)
  })

  it('旧 converted 原样保留（含 proposalId 指针），不参与抑制也不被替换', () => {
    const { p, a } = twoChapterIds()
    const conv = mkOp(a, {
      category: 'foreshadow-unresolved',
      severity: 'hard',
      anchor: { quote: '伏笔未回收处', paraIndex: 1 },
      status: 'converted',
      proposalId: 'prop-abc-1'
    })
    saveRun(p, a, [conv], MODEL)
    const rerun = mkOp(a, { anchor: { quote: '全新问题', paraIndex: 5 } })
    const merged = saveRun(p, a, [rerun], MODEL)
    const kept = merged.find((o) => o.id === conv.id)
    expect(kept?.status).toBe('converted')
    expect(kept?.proposalId).toBe('prop-abc-1')
    expect(merged).toHaveLength(2)
  })

  it('按章替换：另一章意见原样存活（spec Q4「不在新范围内的章不幽灵堆积」）', () => {
    const { p, a, b } = twoChapterIds()
    const oa = mkOp(a)
    const ob = mkOp(b, { anchor: { quote: '乙章独有意见', paraIndex: 0 } })
    saveRun(p, a, [oa], MODEL)
    saveRun(p, b, [ob], MODEL)
    const mergedA = saveRun(p, a, [mkOp(a, { anchor: { quote: '甲章新问题', paraIndex: 1 } })], MODEL)
    expect(mergedA.every((o) => o.chapterId === a)).toBe(true)
    expect(loadReviews(p, b)).toEqual([ob]) // 乙章一字未动
  })

  it('model 参数盖章为单一权威（入参意见的 model 被 run 的模型覆写）', () => {
    const { p, a } = twoChapterIds()
    const o = mkOp(a, { model: '被渲染层漏盖的旧值' })
    const merged = saveRun(p, a, [o], '实际发请求的模型')
    expect(merged[0].model).toBe('实际发请求的模型')
  })

  it('部分写零污染：批次含非法意见 → REVIEW_INVALID 抛穿，旧档字节原封不动', () => {
    const { p, a } = twoChapterIds()
    const good = mkOp(a)
    saveRun(p, a, [good], MODEL)
    const before = readFileSync(reviewFile(p, a), 'utf8')
    const bad = mkOp(a, { anchor: { quote: '新问题', paraIndex: 3 }, status: 'archived' as ReviewOpinion['status'] })
    expect(() => saveRun(p, a, [mkOp(a, { anchor: { quote: '又一个新问题', paraIndex: 4 } }), bad], MODEL)).toThrow(
      /REVIEW_INVALID/
    )
    expect(readFileSync(reviewFile(p, a), 'utf8')).toBe(before)
    expect(loadReviews(p, a)).toEqual([good])
  })

  it('意见的 chapterId 与目标章不符 → REVIEW_INVALID 拒落（幻影意见不入他章账）', () => {
    const { p, a, b } = twoChapterIds()
    expect(() => saveRun(p, a, [mkOp(b)], MODEL)).toThrow(/REVIEW_INVALID/)
    expect(existsSync(reviewFile(p, a))).toBe(false)
  })

  it('空批次合法：saveRun 全量重审可传 []（旧 open 全转 stale，dismissed/converted 留存）', () => {
    const { p, a } = twoChapterIds()
    const o = mkOp(a)
    saveRun(p, a, [o], MODEL)
    const merged = saveRun(p, a, [], MODEL)
    expect(merged).toHaveLength(1)
    expect(merged[0].stale).toBe(true)
  })
})

describe('dismissReview / markReviewConverted：状态迁移唯一写入口', () => {
  function withChapter() {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    return { p, a: ch.id }
  }

  it('dismiss：open → dismissed 落盘；重复 dismiss 幂等；dismissed 参与后续抑制由上游矩阵钉（此处测迁移）', () => {
    const { p, a } = withChapter()
    const o = mkOp(a)
    saveRun(p, a, [o], MODEL)
    const after = dismissReview(p, a, o.id)
    expect(after.find((x) => x.id === o.id)?.status).toBe('dismissed')
    expect(loadReviews(p, a).find((x) => x.id === o.id)?.status).toBe('dismissed')
    expect(() => dismissReview(p, a, o.id)).not.toThrow() // 幂等（双击/竞态）
  })

  it('dismiss：unknown id → REVIEW_MISSING；converted 不可驳回 → REVIEW_NOT_OPEN', () => {
    const { p, a } = withChapter()
    expect(() => dismissReview(p, a, randomUUID())).toThrow(/REVIEW_MISSING/)
    const conv = mkOp(a, { status: 'converted', proposalId: 'prop-x-1' })
    saveRun(p, a, [conv], MODEL)
    expect(() => dismissReview(p, a, conv.id)).toThrow(/REVIEW_NOT_OPEN/)
  })

  it('markConverted：open → converted + proposalId 落盘；重复转化拒（指针唯一）', () => {
    const { p, a } = withChapter()
    const o = mkOp(a, { category: 'foreshadow-unresolved', severity: 'hard' })
    saveRun(p, a, [o], MODEL)
    const after = markReviewConverted(p, a, o.id, 'prop-target-1')
    const stored = loadReviews(p, a).find((x) => x.id === o.id)
    expect(stored?.status).toBe('converted')
    expect(stored?.proposalId).toBe('prop-target-1')
    expect(after.find((x) => x.id === o.id)?.status).toBe('converted')
    expect(() => markReviewConverted(p, a, o.id, 'prop-target-2')).toThrow(/REVIEW_NOT_OPEN/)
  })

  it('markConverted：stale open / dismissed 均不可转化（spec Q4 仅非 stale 的 open 可）', () => {
    const { p, a } = withChapter()
    const stale = mkOp(a, { stale: true })
    saveRun(p, a, [stale], MODEL)
    expect(() => markReviewConverted(p, a, stale.id, 'prop-1')).toThrow(/REVIEW_NOT_OPEN/)
    const d = mkOp(a, { status: 'dismissed' })
    saveRun(p, a, [d], MODEL)
    expect(() => markReviewConverted(p, a, d.id, 'prop-1')).toThrow(/REVIEW_NOT_OPEN/)
  })

  it('markConverted：proposalId 空串 → REVIEW_INVALID；unknown id → REVIEW_MISSING', () => {
    const { p, a } = withChapter()
    const o = mkOp(a)
    saveRun(p, a, [o], MODEL)
    expect(() => markReviewConverted(p, a, o.id, '  ')).toThrow(/REVIEW_INVALID/)
    expect(() => markReviewConverted(p, a, randomUUID(), 'prop-1')).toThrow(/REVIEW_MISSING/)
  })

  it('状态迁移落盘后 JSON 文件可读回（单文件全量重写，缩进 2）', () => {
    const { p, a } = withChapter()
    const o = mkOp(a)
    saveRun(p, a, [o], MODEL)
    dismissReview(p, a, o.id)
    const raw = readFileSync(reviewFile(p, a), 'utf8')
    expect((JSON.parse(raw) as ReviewOpinion[])[0].status).toBe('dismissed')
  })
})

describe('listAllReviews：跨章聚合（徽标数据源）', () => {
  it('缺目录 → []；多章文件聚合、坏档 warn+跳过不整体抛', () => {
    const p = mkTmpBook()
    expect(listAllReviews(p)).toEqual([])
    const a = createChapter(p, '甲章').id
    const b = createChapter(p, '乙章').id
    saveRun(p, a, [mkOp(a)], MODEL)
    saveRun(p, b, [mkOp(b, { anchor: { quote: '乙章意见', paraIndex: 0 } })], MODEL)
    expect(listAllReviews(p)).toHaveLength(2)
    mkdirSync(reviewsDir(p), { recursive: true })
    writeFileSync(join(reviewsDir(p), `${randomUUID()}.json`), 'garbage{', 'utf8')
    expect(listAllReviews(p)).toHaveLength(2) // 坏档被容错跳过
    expect(console.warn).toHaveBeenCalled()
  })

  it('非 .json 文件忽略（只认 reviews 账本自己的形状）', () => {
    const p = mkTmpBook()
    mkdirSync(reviewsDir(p), { recursive: true })
    writeFileSync(join(reviewsDir(p), 'notes.md'), '# 手记', 'utf8')
    expect(listAllReviews(p)).toEqual([])
  })
})

// M6 T5——useReview 编排 hook 的可纯测切片（无 jsdom；编排交互面由 T6 CDP 冒烟兜底，
// 镜像 useCompletion.test.ts 先例）。钉死三个纯函数：
// - droppedOpinionCount：carry-in (b)「N 进 M 弃」——parse 静默丢坏条且全丢时与「无意见」
//   不可辨，编排层自对 raw 信封条目数计差值供对话框提示行；
// - appendRetryDecision：carry-in (c) PROPOSAL_APPEND_TARGET 竞态的三分决策
//   （rethrow / 重查后有 pending→retry / 无→fallback-new），纯字符串判定防错判；
// - countOpenOpinions：徽标计数谓词（open 含 stale=true——「上次未重现」仍待处理）。
import { describe, expect, it } from 'vitest'
import type { ReviewOpinion } from '@/common/reviewTypes'
import { appendRetryDecision, countOpenOpinions, droppedOpinionCount } from './useReview'

describe('droppedOpinionCount：raw 信封条目数 − parsed 数', () => {
  it('正常信封：5 进 3 弃 2（parsedCount 由调用方从 parseReviewOpinions 结果给出）', () => {
    const raw = JSON.stringify({ opinions: [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }] })
    expect(droppedOpinionCount(raw, 3)).toBe(2)
  })
  it('全部存活 → 0；空信封 → 0', () => {
    const raw = JSON.stringify({ opinions: [{ a: 1 }, { b: 2 }] })
    expect(droppedOpinionCount(raw, 2)).toBe(0)
    expect(droppedOpinionCount(JSON.stringify({ opinions: [] }), 0)).toBe(0)
  })
  it('坏条目也计「进」（null/字符串/数组等非对象条目照样是模型产出的条目）', () => {
    const raw = JSON.stringify({ opinions: [{ a: 1 }, null, 'junk', [1, 2]] })
    expect(droppedOpinionCount(raw, 1)).toBe(3)
  })
  it('抠不出 JSON / 顶层非对象 / opinions 非数组 → 0（parse-failed 路径不走本函数，防御归零）', () => {
    expect(droppedOpinionCount('完全不是 JSON', 0)).toBe(0)
    expect(droppedOpinionCount('[1,2,3]', 0)).toBe(0)
    expect(droppedOpinionCount('{"notes":[]}', 0)).toBe(0)
    expect(droppedOpinionCount('', 0)).toBe(0)
  })
  it('parsedCount 大于条目数 → 夹 0（绝不回负数——上游计数漂移不该炸出负提示）', () => {
    const raw = JSON.stringify({ opinions: [{ a: 1 }] })
    expect(droppedOpinionCount(raw, 5)).toBe(0)
  })
})

describe('appendRetryDecision：PROPOSAL_APPEND_TARGET 竞态三分', () => {
  const wrapped =
    "Error invoking remote method 'proposal:appendChanges': Error: PROPOSAL_APPEND_TARGET: prop-11111111-1700000000"
  it('APPEND_TARGET（含 IPC 包装形态）+ 重查见 pending → retry', () => {
    expect(appendRetryDecision(wrapped, { id: 'prop-2' })).toBe('retry')
    expect(appendRetryDecision('PROPOSAL_APPEND_TARGET: prop-x', { id: 'prop-y' })).toBe('retry')
  })
  it('APPEND_TARGET + 重查无 pending（null/undefined）→ fallback-new（回落新建提案文件）', () => {
    expect(appendRetryDecision(wrapped, null)).toBe('fallback-new')
    expect(appendRetryDecision(wrapped, undefined)).toBe('fallback-new')
  })
  it('其它错误一律 rethrow（即使重查恰好有 pending——不得把 PROPOSAL_INVALID 当竞态吞掉）', () => {
    expect(appendRetryDecision('Error: PROPOSAL_INVALID: append.changes[0]: …', { id: 'p' })).toBe('rethrow')
    expect(appendRetryDecision('Error: PROPOSAL_MISSING: prop-x', { id: 'p' })).toBe('rethrow')
    expect(appendRetryDecision('boom', null)).toBe('rethrow')
    expect(appendRetryDecision('', null)).toBe('rethrow')
  })
  it('前缀必须整词命中（防 id/正文里偶然出现的子串误判为竞态）', () => {
    expect(appendRetryDecision('Error: PROPOSAL_APPEND_TARGETX: 不是这个码', { id: 'p' })).toBe('rethrow')
  })
})

describe('countOpenOpinions：徽标计数（open 含 stale）', () => {
  const mk = (over: Partial<ReviewOpinion>): ReviewOpinion => ({
    id: 'o1',
    chapterId: '11111111-2222-4333-8444-555555555555',
    category: 'pacing',
    severity: 'soft',
    anchor: { quote: 'q', paraIndex: 0 },
    text: 't',
    status: 'open',
    stale: false,
    createdAt: '2026-10-31T00:00:00.000Z',
    model: 'm',
    ...over
  })
  it('open 与 stale 的 open 都计数；dismissed/converted 不计', () => {
    const list = [
      mk({}),
      mk({ id: 'o2', stale: true }),
      mk({ id: 'o3', status: 'dismissed' }),
      mk({ id: 'o4', status: 'converted', proposalId: 'p1' })
    ]
    expect(countOpenOpinions(list)).toBe(2)
  })
  it('空列表 → 0', () => {
    expect(countOpenOpinions([])).toBe(0)
  })
})

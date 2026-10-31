// M5 Task 5 纯函数单测（无 jsdom，编排层由 T6 CDP 冒烟兜底）：
// - sliceProseBefore：光标前正文的码点安全尾切片——补全上下文预算的入口闸，
//   绝不劈开代理对（astral 字符在切点被劈成半个 UTF-16 码元是本函数唯一的真实地雷）；
// - completionSilentKinds：静默策略表——与 ai-types 的 kind 全集做集合相等断言，
//   未来任何新错误 kind 落地都会让本测试变红，强制「补全对新 kind 静默还是打扰」显式表态。
import { describe, expect, it } from 'vitest'
import { AI_ERROR_KINDS, type AiErrorKind } from '@/common/ai-types'
import { completionSilentKinds, sliceProseBefore } from './useCompletion'

describe('sliceProseBefore', () => {
  it('空文本 → 空串（一切偏移下都无可续之前文）', () => {
    expect(sliceProseBefore('', 0, 1500)).toBe('')
    expect(sliceProseBefore('', 5, 10)).toBe('')
  })

  it('光标 0 → 空串（含负偏移夹零，绝不越界成负 slice）', () => {
    expect(sliceProseBefore('剑光如雨，长街尽头灯火明', 0, 10)).toBe('')
    expect(sliceProseBefore('abc', -3, 10)).toBe('')
  })

  it('maxChars 大于前文长度 → 原样全量（不补位、不截断）', () => {
    expect(sliceProseBefore('短句。', 3, 1500)).toBe('短句。')
  })

  it('maxChars<=0 → 空串（避开 slice(-0) 返回全量的陷阱）', () => {
    expect(sliceProseBefore('abc', 3, 0)).toBe('')
    expect(sliceProseBefore('abc', 3, -1)).toBe('')
  })

  it('普通尾切片：保尾不保头（语境最靠近光标的部分优先）', () => {
    expect(sliceProseBefore('abcdefgh', 8, 3)).toBe('fgh')
    // 光标后的正文绝不进入结果
    expect(sliceProseBefore('abcdefGH', 6, 3)).toBe('def')
  })

  it('astral 字符落在切点：劈开的代理对高半码元被丢弃，绝不产出孤立半字', () => {
    // 'x'(0) '🐉'(1-2, 代理对) 'y'(3)：offset=2 落在对中间 → 前文只能取到 'x'
    expect(sliceProseBefore('x🐉y', 2, 100)).toBe('x')
    expect(sliceProseBefore('x🐉y', 3, 100)).toBe('x🐉')
  })

  it('astral 边界 + 尾预算叠加：先按码点安全缩头，再按码点取尾', () => {
    // '🐉'(0-1) '🐉'(2-3) 'x'(4)：offset=3 劈开第二个对 → 有效前文 '🐉'；再取尾 1 码点仍是 '🐉'
    expect(sliceProseBefore('🐉🐉x', 3, 1)).toBe('🐉')
    // 整段合法时按码点计数（非码元）：三个 emoji = 6 码元 = 3 码点，取尾 2 得后两个
    expect(sliceProseBefore('🐉🐉🐉', 6, 2)).toBe('🐉🐉')
  })

  it('偏移超出文本长度 → 按文本末尾夹取', () => {
    expect(sliceProseBefore('abc', 99, 2)).toBe('bc')
  })
})

describe('completionSilentKinds', () => {
  it('与 ai-types 的 kind 全集集合相等（补全对所有错误静默；新 kind 落地即红灯）', () => {
    const silent = new Set<AiErrorKind>(completionSilentKinds)
    const all = new Set<AiErrorKind>(AI_ERROR_KINDS)
    expect(silent).toEqual(all)
    // 表自身不得有重复项（重复=策略表被手抄改坏的信号）
    expect(completionSilentKinds.length).toBe(all.size)
  })
})

// M6 T1——审阅意见 schema 纯函数测试：validateReviewOpinion（status 三值 + stale 布尔钉死、
// 六类白名单、severity×类别一致性钉死）、normalizeQuote（去空白 + 全角 ASCII 转半角）、
// suppressionKey（稳定 + 跨章不抑制，spec builder-check Q6 修订）、relocateAnchor
// （段内命中 / 跨段全文命中 / 缺失三态；段按空行切，同导出侧 /\n{2,}/ 先例）。
// 纯逻辑零 I/O——临时目录归 bookStore/reviews.test.ts。
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ReviewCategory, ReviewOpinion } from './reviewTypes'
import {
  HARD_CATEGORIES,
  REVIEW_CATEGORIES,
  REVIEW_QUOTE_MAX_LENGTH,
  REVIEW_STATUSES,
  SOFT_CATEGORIES,
  normalizeQuote,
  relocateAnchor,
  suppressionKey,
  validateReviewOpinion
} from './reviewTypes'

const CHAPTER = '11111111-2222-4333-8444-555555555555'

/** 合法样本工厂：spread 覆盖即得各种坏形状（同 proposal.test.ts mkFile 手法）。 */
function mkOpinion(over: Partial<ReviewOpinion> = {}): ReviewOpinion {
  return {
    id: randomUUID(),
    chapterId: CHAPTER,
    category: 'foreshadow-unresolved',
    severity: 'hard',
    anchor: { quote: '她望向远山，低声念出一个名字。', paraIndex: 3 },
    text: '此伏笔至本章仍未回收。',
    suggestion: '可在结尾让名字应有回声。',
    targetEntityId: randomUUID(),
    status: 'open',
    stale: false,
    createdAt: new Date().toISOString(),
    model: 'test-model',
    ...over
  }
}

describe('常量表（单一权威）', () => {
  it('六类白名单 = HARD ∪ SOFT，两表不相交且各三成员', () => {
    expect([...REVIEW_CATEGORIES].sort()).toEqual(
      ['foreshadow-unresolved', 'flatness', 'motivation-break', 'pacing', 'prose-craft', 'setting-conflict'].sort()
    )
    expect(HARD_CATEGORIES).toEqual(['foreshadow-unresolved', 'setting-conflict', 'motivation-break'])
    expect(SOFT_CATEGORIES).toEqual(['pacing', 'flatness', 'prose-craft'])
    for (const c of HARD_CATEGORIES) expect(SOFT_CATEGORIES).not.toContain(c)
  })
  it('status 恰好三值（stale 是标记非第四枚举，spec Q4 钉板）', () => {
    expect(REVIEW_STATUSES).toEqual(['open', 'dismissed', 'converted'])
  })
})

describe('validateReviewOpinion：合法形状零错误', () => {
  it('完整合法意见 → []', () => {
    expect(validateReviewOpinion(mkOpinion())).toEqual([])
  })
  it('可选字段缺席合法（suggestion/targetEntityId/proposalId 皆可省）', () => {
    const o = mkOpinion()
    delete o.suggestion
    delete o.targetEntityId
    delete o.proposalId
    expect(validateReviewOpinion(o)).toEqual([])
  })
  it('六类白名单逐类放行（severity 按表配对）', () => {
    for (const category of REVIEW_CATEGORIES) {
      const severity = HARD_CATEGORIES.includes(category) ? 'hard' : 'soft'
      expect(validateReviewOpinion(mkOpinion({ category, severity }))).toEqual([])
    }
  })
  it('未知多余字段容忍（向前兼容，同 proposal 口径）', () => {
    const o = { ...mkOpinion(), futureField: 42 }
    expect(validateReviewOpinion(o)).toEqual([])
  })
})

describe('validateReviewOpinion：status 三值 + stale 布尔钉死', () => {
  it('status 表外枚举 → opinion.status 错', () => {
    const errors = validateReviewOpinion(mkOpinion({ status: 'archived' as ReviewOpinion['status'] }))
    expect(errors.some((e) => e.includes('opinion.status'))).toBe(true)
  })
  it('status 缺失 → opinion.status 错', () => {
    const o = mkOpinion() as unknown as Record<string, unknown>
    delete o.status
    expect(validateReviewOpinion(o).some((e) => e.includes('opinion.status'))).toBe(true)
  })
  it('stale 字符串 "true" / 数字 1 → 必须报 opinion.stale（布尔钉死）', () => {
    for (const bad of ['true', 1]) {
      const errors = validateReviewOpinion(mkOpinion({ stale: bad as unknown as boolean }))
      expect(errors.some((e) => e.includes('opinion.stale'))).toBe(true)
    }
  })
  it('stale 缺失 → 报 opinion.stale（缺省绝不宽容成 false——重审语义依赖此位）', () => {
    const o = mkOpinion() as unknown as Record<string, unknown>
    delete o.stale
    expect(validateReviewOpinion(o).some((e) => e.includes('opinion.stale'))).toBe(true)
  })
})

describe('validateReviewOpinion：六类白名单与配对表', () => {
  it('表外类别 → opinion.category 错', () => {
    const errors = validateReviewOpinion(mkOpinion({ category: 'romance' as ReviewCategory }))
    expect(errors.some((e) => e.includes('opinion.category'))).toBe(true)
  })
  it('severity×类别失配（硬类标软/软类标硬）→ opinion.severity 错', () => {
    const wrong1 = validateReviewOpinion(mkOpinion({ category: 'foreshadow-unresolved', severity: 'soft' }))
    expect(wrong1.some((e) => e.includes('opinion.severity'))).toBe(true)
    const wrong2 = validateReviewOpinion(mkOpinion({ category: 'pacing', severity: 'hard' }))
    expect(wrong2.some((e) => e.includes('opinion.severity'))).toBe(true)
  })
})

describe('validateReviewOpinion：锚与必备字段', () => {
  it('anchor 非对象 → opinion.anchor 错', () => {
    const errors = validateReviewOpinion(mkOpinion({ anchor: '她望向远山' as unknown as ReviewOpinion['anchor'] }))
    expect(errors.some((e) => e.includes('opinion.anchor'))).toBe(true)
  })
  it('anchor.quote 空串/纯空白 → 报 anchor.quote；超上限（病理输出）→ 报 anchor.quote', () => {
    expect(validateReviewOpinion(mkOpinion({ anchor: { quote: '   ', paraIndex: 0 } })).some((e) => e.includes('quote'))).toBe(true)
    const long = validateReviewOpinion(mkOpinion({ anchor: { quote: '字'.repeat(REVIEW_QUOTE_MAX_LENGTH + 1), paraIndex: 0 } }))
    expect(long.some((e) => e.includes('quote'))).toBe(true)
    // 恰好在上限内放行（宽容于模型越界一截，同 proposal 300 口径）
    expect(validateReviewOpinion(mkOpinion({ anchor: { quote: '字'.repeat(REVIEW_QUOTE_MAX_LENGTH), paraIndex: 0 } }))).toEqual([])
  })
  it('anchor.paraIndex 小数/负数/字符串 → 报 paraIndex', () => {
    for (const bad of [1.5, -1, '2']) {
      const errors = validateReviewOpinion(mkOpinion({ anchor: { quote: '她望向远山', paraIndex: bad as unknown as number } }))
      expect(errors.some((e) => e.includes('paraIndex'))).toBe(true)
    }
    expect(validateReviewOpinion(mkOpinion({ anchor: { quote: '她望向远山', paraIndex: 0 } }))).toEqual([])
  })
  it('text 空串 / id 空串 / model 空串 → 各报其位', () => {
    expect(validateReviewOpinion(mkOpinion({ text: '  ' })).some((e) => e.includes('opinion.text'))).toBe(true)
    expect(validateReviewOpinion(mkOpinion({ id: '' })).some((e) => e.includes('opinion.id'))).toBe(true)
    expect(validateReviewOpinion(mkOpinion({ model: '' })).some((e) => e.includes('opinion.model'))).toBe(true)
  })
  it('chapterId 非 UUID 形状 → 报 opinion.chapterId（自家产物钉 UUID，同 proposal 先例）', () => {
    expect(validateReviewOpinion(mkOpinion({ chapterId: '../evil' })).some((e) => e.includes('opinion.chapterId'))).toBe(true)
  })
  it('proposalId / targetEntityId 出现但为空串 → 报其位', () => {
    expect(validateReviewOpinion(mkOpinion({ proposalId: '' })).some((e) => e.includes('proposalId'))).toBe(true)
    expect(validateReviewOpinion(mkOpinion({ targetEntityId: '   ' })).some((e) => e.includes('targetEntityId'))).toBe(true)
  })
  it('非对象输入 → 单条类型错误', () => {
    expect(validateReviewOpinion('nope')).toEqual(['opinion: expected object, got string'])
    expect(validateReviewOpinion(null)[0]).toContain('null')
  })
})

describe('normalizeQuote：去所有空白 + 全角 ASCII 转半角', () => {
  it('空白全剥（半角空格/制表/换行/全角空格 U+3000/nbsp）', () => {
    expect(normalizeQuote('甲 乙\t丙\n丁　戊 己')).toBe('甲乙丙丁戊己')
  })
  it('全角 ASCII（FF01–FF5E）转半角：字母/数字/标点', () => {
    expect(normalizeQuote('ＡＢＣ０１２３，．？！：「」')).toBe('ABC0123,.?!:「」')
    // U+3000 是空白被剥除（不是转成半角空格）
    expect(normalizeQuote('　')).toBe('')
  })
  it('幂等 + 非 ASCII 汉字原样', () => {
    const once = normalizeQuote('他说　了： ＯＫ。')
    // ：U+FF1A 落在全角 ASCII 区 → 转半角 ':'；。U+3002 不在该区，原样保留
    expect(once).toBe('他说了:OK。')
    expect(normalizeQuote(once)).toBe(once)
  })
})

describe('suppressionKey：稳定 + 跨章不抑制（spec Q6）', () => {
  const base = { chapterId: CHAPTER, category: 'pacing' as ReviewCategory, anchor: { quote: '中段铺排过缓', paraIndex: 2 } }
  it('同输入两次调用相等（稳定，纯函数）', () => {
    expect(suppressionKey(base)).toBe(suppressionKey({ ...base, anchor: { ...base.anchor } }))
  })
  it('空白/全角变体同键（驳回过「甲 乙」就不再被「ＡＢ」复读骚扰）', () => {
    const k1 = suppressionKey({ ...base, anchor: { quote: '甲 乙　丙', paraIndex: 0 } })
    const k2 = suppressionKey({ ...base, anchor: { quote: 'ＡＢＣ'.replace('Ａ', '甲').replace('Ｂ', '乙').replace('Ｃ', '丙'), paraIndex: 9 } })
    expect(k1).toBe(k2) // paraIndex 不参与键——锚漂移后驳回仍有效
  })
  it('跨章不抑制：同类别同引文、chapterId 不同 → 键不同', () => {
    const other = suppressionKey({ ...base, chapterId: randomUUID() })
    expect(other).not.toBe(suppressionKey(base))
  })
  it('同类不同引文 / 同引文不同类 → 键不同', () => {
    expect(suppressionKey({ ...base, anchor: { quote: '结尾仓促', paraIndex: 2 } })).not.toBe(suppressionKey(base))
    expect(suppressionKey({ ...base, category: 'flatness' })).not.toBe(suppressionKey(base))
  })
})

describe('relocateAnchor：三态（段内命中 / 跨段全文命中 / 缺失）', () => {
  // 三段正文（段间 \n\n）。P1 含全角与空格，用于归一命中。
  const P0 = '黎明前的山脊一片寂静。'
  const P1 = '她 望了望　远山，低声念出一个名字。'
  const P2 = '山风把那个名字送得很远。'
  const body = [P0, P1, P2].join('\n\n')

  it('段内命中：paraIndex 正确 + 引文逐字 → offsets 精确圈住原文', () => {
    const r = relocateAnchor(body, { quote: '黎明前的山脊一片寂静。', paraIndex: 0 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(0)
    expect(r.startOffset).toBe(body.indexOf(P0))
    expect(r.endOffset).toBe(body.indexOf(P0) + P0.length)
    expect(body.slice(r.startOffset, r.endOffset)).toBe(P0)
  })
  it('归一命中：引文去空白/转半角后匹配，offsets 覆盖原文含空白全段', () => {
    const r = relocateAnchor(body, { quote: '她望了望远山，低声念出一个名字。', paraIndex: 1 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(1)
    expect(body.slice(r.startOffset, r.endOffset)).toBe(P1)
  })
  it('跨段全文命中：paraIndex 漂错（0）但引文在段 2 → found 且回报真实段号', () => {
    const r = relocateAnchor(body, { quote: '山风把那个名字送得很远。', paraIndex: 0 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(2)
    expect(body.slice(r.startOffset, r.endOffset)).toBe(P2)
  })
  it('paraIndex 越界（99）不致失败——退化全文搜', () => {
    const r = relocateAnchor(body, { quote: '山风把那个名字', paraIndex: 99 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(2)
  })
  it('缺失：引文不在正文 → { found: false }（反目标：绝不假装命中）', () => {
    expect(relocateAnchor(body, { quote: '雪落满了长桥', paraIndex: 0 })).toEqual({ found: false })
  })
  it('空引文 / 空白引文 / 空正文 → found:false', () => {
    expect(relocateAnchor(body, { quote: '', paraIndex: 0 })).toEqual({ found: false })
    expect(relocateAnchor(body, { quote: ' 　 ', paraIndex: 0 })).toEqual({ found: false })
    expect(relocateAnchor('', { quote: '黎明', paraIndex: 0 })).toEqual({ found: false })
  })
  it('CRLF 正文（\r\n\r\n 分段）同样命中——分段口径宽容换行符种类', () => {
    const crlf = '第一段文字。\r\n\r\n第二段文字。\r\n\r\n第三段文字。'
    const r = relocateAnchor(crlf, { quote: '第二段文字。', paraIndex: 0 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(1)
    expect(crlf.slice(r.startOffset, r.endOffset)).toBe('第二段文字。')
  })
  it('段内优先于全文：引文同时存在于段 0 与段 2，paraIndex=2 → 命中段 2（不漂移）', () => {
    const dup = '回声。\n\n别的段落。\n\n回声。'
    const r = relocateAnchor(dup, { quote: '回声。', paraIndex: 2 })
    expect(r.found).toBe(true)
    if (!r.found) return
    expect(r.paraIndex).toBe(2)
    expect(r.startOffset).toBe(dup.length - '回声。'.length)
  })
})

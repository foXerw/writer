// M6 T2——审阅 prompt 装配器 + 信封解析纯函数测试。
// 钉死：预算启发式单点（正文码点/2 向上取整，超顶先拒后装）；**正文全文不截断**；
// paraIndex 编号与 relocateAnchor 同一分段规则（T1 结转关键项——CRLF 书防段号漂移，
// 期望段号全部手写字面量，绝不在测试里复算正则）；六类词典+信封契约入 system；
// 卡行 `[id] 投影` 复用 completionContext；parse 四路（信封 ok/坏类/缺锚字段/
// quote 幻觉保留）+ 信封五字段由 T5 盖章（本层缺席）+ chapterId 调用方覆写。
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { CharacterV2, WorldEntryV2 } from './schema'
import { REVIEW_CATEGORIES, relocateAnchor } from './reviewTypes'
import { projectCharacterCard, projectWorldCard } from './completionContext'
import type { ReviewPromptChapter } from './reviewContext'
import {
  REVIEW_QUOTE_PROMPT_MAX,
  buildReviewPrompt,
  estimateReviewTokens,
  parseReviewOpinions,
  reviewCardLine
} from './reviewContext'

const CHAPTER = '11111111-2222-4333-8444-555555555555'

function mkChapters(overrides: Partial<ReviewPromptChapter> = {}): ReviewPromptChapter[] {
  return [{ id: CHAPTER, title: '第一章 远山', body: '甲段。\n\n乙段。\n\n丙段。', ...overrides }]
}

function baseArgs(overrides: Partial<Parameters<typeof buildReviewPrompt>[0]> = {}) {
  return {
    bookName: '远山灯火',
    synopsis: '少年离乡，剑塔寻父。',
    chapters: mkChapters(),
    cards: [] as string[],
    openForeshadow: [] as string[],
    maxTokens: 4096,
    ...overrides
  }
}

function makeCharacter(overrides: Partial<CharacterV2> = {}): CharacterV2 {
  return {
    id: 'char-1',
    name: '沈孤鸿',
    gender: 'male',
    age: 22,
    role: 'protagonist',
    appearance: '一袭青衫',
    personality: '外冷内热',
    background: '剑阁遗孤',
    relationships: [],
    arc: [],
    tags: [],
    links: [],
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides
  }
}

function makeWorld(overrides: Partial<WorldEntryV2> = {}): WorldEntryV2 {
  return {
    id: 'world-1',
    title: '极光塔',
    category: 'location',
    content: '悬浮于北境的金属巨塔。',
    parentId: null,
    order: 1,
    tags: [],
    links: [],
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// 预算与装配闸门
// ---------------------------------------------------------------------------

describe('estimateReviewTokens：正文码点/2 向上取整（启发式单点钉死）', () => {
  it('3 码点 → 2（ceil）；emoji 按码点计 1 不劈代理对', () => {
    expect(estimateReviewTokens([{ body: '一二三' }])).toBe(2)
    expect(estimateReviewTokens([{ body: '👀' }])).toBe(1)
    expect(estimateReviewTokens([])).toBe(0)
  })
  it('多章合计', () => {
    expect(estimateReviewTokens([{ body: '一二三四五六' }, { body: '七八九十' }])).toBe(5)
  })
})

describe('buildReviewPrompt：先判预算，任何装配都不发生（UI 可直接拒绝）', () => {
  it('超顶 → 只有 {kind,estimated} 两键，不带 system/user 半字', () => {
    const r = buildReviewPrompt(baseArgs({ chapters: mkChapters({ body: '字'.repeat(100) }), maxTokens: 49 }))
    expect(r).toEqual({ kind: 'over-budget', estimated: 50 })
  })
  it('边界：estimated === maxTokens 放行', () => {
    const r = buildReviewPrompt(baseArgs({ chapters: mkChapters({ body: '字'.repeat(100) }), maxTokens: 50 }))
    expect(r.kind).toBe('ok')
  })
})

describe('buildReviewPrompt：正文全文入 prompt（锚必原文，绝不截断）', () => {
  it('8000 码点正文逐字在场，尾部字句可见，无省略号截断', () => {
    const long = '远山如黛，灯火可亲。'.repeat(800) // 8000 码点 → est 4000
    const r = buildReviewPrompt(baseArgs({ chapters: mkChapters({ body: long }), maxTokens: 100000 }))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.user).toContain(long.slice(-30))
    expect(r.user).toContain(long.slice(0, 30))
    expect(r.user).not.toContain('……')
  })
})

// ---------------------------------------------------------------------------
// T1 结转关键项：paraIndex 编号与 relocateAnchor 同一分段规则
// ---------------------------------------------------------------------------

describe('paraIndex 编号 = relocateAnchor 分段（CRLF 书漂移回归钉，期望段号全部手写）', () => {
  // 手算三段：P0='甲段。'；P1='乙 段。\r\n丁前折行。'（段内软换行不裂段）；P2='末段。'
  // 旧 /\n{2,}/ 口径这里只有一段；T1 首版 (?:\r\n|\r|\n){2,} 会把 P1 拆成两段——都被本钉拒绝。
  const body = '甲段。\r\n\r\n乙 段。\r\n丁前折行。\r\n\r\n末段。'

  it('prompt 展示 [0]/[1]/[2] 三个手写段号，段内容逐字在场', () => {
    const r = buildReviewPrompt(baseArgs({ chapters: mkChapters({ body }), maxTokens: 4096 }))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.user).toContain('[0] 甲段。')
    expect(r.user).toContain('[1] 乙 段。\r\n丁前折行。')
    expect(r.user).toContain('[2] 末段。')
    expect(r.user).not.toContain('[3]')
  })

  it('展示段号回灌 relocateAnchor 全部段内命中（模型所见=渲染器所切）', () => {
    for (const [i, quote] of [
      [0, '甲段。'],
      [1, '乙 段。丁前折行。'], // 归一化后跨软换行命中
      [2, '末段。']
    ] as const) {
      const hit = relocateAnchor(body, { quote, paraIndex: i })
      expect(hit.found).toBe(true)
      if (!hit.found) return
      expect(hit.paraIndex).toBe(i)
    }
  })

  it('paraIndex 越界提示仍能按真实分段命中（99 → 段 1）', () => {
    const hit = relocateAnchor(body, { quote: '丁前折行。', paraIndex: 99 })
    expect(hit.found).toBe(true)
    if (!hit.found) return
    expect(hit.paraIndex).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// system：人格 + 六类词典 + 信封契约
// ---------------------------------------------------------------------------

describe('system：读者人格 + 六类词典 + 输出信封契约', () => {
  function systemOf(): string {
    const r = buildReviewPrompt(baseArgs())
    if (r.kind !== 'ok') throw new Error('expected ok')
    return r.system
  }

  it('六类枚举逐类入 system 且每类配一句判定标准', () => {
    const system = systemOf()
    expect(system).toContain('读者')
    for (const c of REVIEW_CATEGORIES) {
      expect(system).toContain(`- ${c}（`)
      const line = system.split('\n').find((l) => l.startsWith(`- ${c}（`)) ?? ''
      expect(line.length).toBeGreaterThan(c.length + 20) // 类别名 + 判定标准句在场
    }
  })
  it('severity 是类别投影：system 声明配对表且校验拒失配', () => {
    const system = systemOf()
    expect(system).toContain('hard')
    expect(system).toContain('soft')
    expect(system).toContain('失配整条丢弃')
  })
  it('信封契约字面形状 + quote 逐字铁律 + 40 字约定 + targetEntityId 纪律 + 信封字段勿输出', () => {
    const system = systemOf()
    expect(system).toContain('{"opinions":[{"category"')
    expect(system).toContain('"anchor":{"quote"')
    expect(system).toContain('paraIndex')
    expect(system).toContain('逐字取自')
    expect(system).toContain(`不超过 ${REVIEW_QUOTE_PROMPT_MAX} 字`)
    expect(system).toContain('不得改写')
    expect(system).toContain('targetEntityId')
    expect(system).toContain('不要输出')
    expect(system).toContain('id、createdAt、model、status、stale')
    expect(system).toContain('复述章节 id')
  })
  it('确定性：同入参两次装配逐字段相等（纯函数）', () => {
    expect(buildReviewPrompt(baseArgs())).toEqual(buildReviewPrompt(baseArgs()))
  })
})

// ---------------------------------------------------------------------------
// user：块骨架与卡行
// ---------------------------------------------------------------------------

describe('user：书名/梗概/卡/台账/正文块骨架', () => {
  it('cards 与 openForeshadow 逐行入块；空数组块整块省略（不留悬空头）', () => {
    const r = buildReviewPrompt(
      baseArgs({ cards: ['[a1] 甲卡', '[b2] 乙卡'], openForeshadow: ['- f1 红绳（埋于第2章）'] })
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.user).toContain('【设定卡】\n[a1] 甲卡\n[b2] 乙卡')
    expect(r.user).toContain('【未结伏笔台账】\n- f1 红绳（埋于第2章）')
    const bare = buildReviewPrompt(baseArgs())
    expect(bare.kind).toBe('ok')
    if (bare.kind !== 'ok') return
    expect(bare.user).not.toContain('【设定卡】')
    expect(bare.user).not.toContain('【未结伏笔台账】')
  })
  it('章块携标题与 id（仅供定位）；书名/梗概空白整块省略（chore 纪律）', () => {
    const r = buildReviewPrompt(baseArgs())
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.user).toContain('《第一章 远山》')
    expect(r.user).toContain(`id：${CHAPTER}`)
    expect(r.user).toContain('【书名】远山灯火')
    const blank = buildReviewPrompt(baseArgs({ bookName: ' 　', synopsis: '' }))
    expect(blank.kind).toBe('ok')
    if (blank.kind !== 'ok') return
    expect(blank.user).not.toContain('【书名】')
    expect(blank.user).not.toContain('【梗概】')
  })
  it('reviewCardLine：投影复用 M5 函数且 id 前缀逐字 `[id] …`', () => {
    const c = makeCharacter()
    const w = makeWorld()
    expect(reviewCardLine(c)).toBe(`[char-1] ${projectCharacterCard(c)}`)
    expect(reviewCardLine(w)).toBe(`[world-1] ${projectWorldCard(w)}`)
    expect(reviewCardLine(c)).toBe('[char-1] 沈孤鸿（protagonist）：一袭青衫／外冷内热／剑阁遗孤')
    const r = buildReviewPrompt(baseArgs({ cards: [reviewCardLine(c)] }))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.user).toContain('[char-1] 沈孤鸿（protagonist）')
  })
})

// ---------------------------------------------------------------------------
// parseReviewOpinions 四路
// ---------------------------------------------------------------------------

function validEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'setting-conflict',
    severity: 'hard',
    anchor: { quote: '乙段。', paraIndex: 1 },
    text: '极光塔位置与第二章矛盾。',
    ...over
  }
}

describe('parseReviewOpinions：路1 信封 ok', () => {
  it('围栏+寒暄包裹的合法信封 → 逐条解析，五信封字段缺席、chapterId 注入', () => {
    const raw = '好的，以下是我的审阅：\n```json\n' +
      JSON.stringify({
        opinions: [
          validEntry(),
          validEntry({
            category: 'pacing',
            severity: 'soft',
            anchor: { quote: '丙段。', paraIndex: 2 },
            text: '三连景物描写拖速。',
            suggestion: '压到两句。',
            targetEntityId: 'char-1'
          })
        ]
      }) +
      '\n```'
    const r = parseReviewOpinions(raw, CHAPTER)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.opinions).toHaveLength(2)
    expect(r.opinions[0]).toEqual({
      chapterId: CHAPTER,
      category: 'setting-conflict',
      severity: 'hard',
      anchor: { quote: '乙段。', paraIndex: 1 },
      text: '极光塔位置与第二章矛盾。'
    })
    expect(r.opinions[1]?.suggestion).toBe('压到两句。')
    expect(r.opinions[1]?.targetEntityId).toBe('char-1')
    for (const o of r.opinions) {
      for (const f of ['id', 'createdAt', 'model', 'status', 'stale', 'proposalId']) {
        expect(o).not.toHaveProperty(f)
      }
    }
  })
  it('空 opinions 数组是合法结果（章没问题）', () => {
    expect(parseReviewOpinions('{"opinions":[]}', CHAPTER)).toEqual({ kind: 'ok', opinions: [] })
  })
  it('模型违约自带 chapterId/id/status/proposalId → 一律覆写剔除，绝不采信', () => {
    const other = randomUUID()
    const raw = JSON.stringify({
      opinions: [
        validEntry({ chapterId: other, id: 'fake-id', status: 'dismissed', stale: true, createdAt: 'x', model: 'y', proposalId: 'p' })
      ]
    })
    const r = parseReviewOpinions(raw, CHAPTER)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.opinions[0]?.chapterId).toBe(CHAPTER)
    expect(r.opinions[0]).not.toHaveProperty('proposalId')
    expect(r.opinions[0]).not.toHaveProperty('status')
  })
})

describe('parseReviewOpinions：路2 坏信封 parse-failed（不带原文，隐私同 organizeResult 裁定 9）', () => {
  for (const [name, raw] of [
    ['整段无 JSON', '本章写得很好，没有问题！'],
    ['顶层数组', '[{"category":"pacing"}]'],
    ['opinions 缺失', '{"changes":[]}'],
    ['opinions 非数组', '{"opinions":"很多意见"}']
  ] as const) {
    it(name, () => {
      const r = parseReviewOpinions(raw, CHAPTER)
      expect(r.kind).toBe('parse-failed')
      expect(Object.keys(r)).toEqual(['kind']) // 结果不携任何原文片段
    })
  }
})

describe('parseReviewOpinions：路3 坏类/缺锚字段——坏条目丢弃、好条目幸存', () => {
  it('表外类别 / severity 失配 / anchor 缺 quote / anchor 缺 paraIndex / 非对象条目各一，好条目在场', () => {
    const raw = JSON.stringify({
      opinions: [
        validEntry({ category: 'romance' }),
        validEntry({ category: 'pacing', severity: 'hard' }), // 软类标硬
        validEntry({ anchor: { paraIndex: 0 } }),
        validEntry({ anchor: { quote: '乙段。' } }),
        '不是对象',
        42,
        null,
        validEntry()
      ]
    })
    const r = parseReviewOpinions(raw, CHAPTER)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.opinions).toHaveLength(1)
    expect(r.opinions[0]?.category).toBe('setting-conflict')
  })
  it('全部坏 → 仍是 ok 空数组（是否视同失败归调用方）', () => {
    expect(parseReviewOpinions('{"opinions":[1,"2",{}]}', CHAPTER)).toEqual({ kind: 'ok', opinions: [] })
  })
})

describe('parseReviewOpinions：路4 quote 幻觉保留（锚失判定归渲染期 relocate）', () => {
  it('引文任何正文都不在 → 不丢弃，原样进结果', () => {
    const r = parseReviewOpinions(
      JSON.stringify({ opinions: [validEntry({ anchor: { quote: '这句话是幻觉的', paraIndex: 7 } })] }),
      CHAPTER
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.opinions).toHaveLength(1)
    expect(r.opinions[0]?.anchor.quote).toBe('这句话是幻觉的')
    expect(r.opinions[0]?.anchor.paraIndex).toBe(7)
  })
})

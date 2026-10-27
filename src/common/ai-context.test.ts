// 上下文装配器契约测试（M4a Task 5，纯函数、零 I/O）。
// 覆盖：estimateTokens 钉值 / 满预算全层 / 预算阶梯按序丢弃（droppedFor 精确）/
// 正文 80% 上限截断保尾 / 红线（非当前章正文与非涉事实体卡绝不出现）/ 空输入退化 / 确定性。
import { describe, expect, it } from 'vitest'
import type { BookMeta, CharacterV2, VolumeDoc, WorldEntryV2 } from './schema'
import type { ContextBook, ContextInputs } from './ai-context'
import {
  ORGANIZE_SYSTEM_SKELETON,
  assembleAiContext,
  estimateTokens
} from './ai-context'

// ---------------------------------------------------------------------------
// fixture：3 卷 × 30 章 × 20 角色 × 10 词条，当前章 ch-15（vol-2）
// ---------------------------------------------------------------------------

const NOW = '2026-10-28T00:00:00.000Z'
const CURRENT = 'ch-15'

const pad = (n: number): string => '补'.repeat(n)

function makeCharacter(id: string): CharacterV2 {
  return {
    id,
    name: `角色${id}`,
    gender: 'male',
    age: 30,
    role: 'supporting',
    appearance: `外貌${pad(20)}`,
    personality: `性格${pad(20)}`,
    background: `背景${pad(20)}`,
    relationships: [],
    arc: [],
    tags: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function makeWorld(id: string): WorldEntryV2 {
  return {
    id,
    title: `词条${id}`,
    category: 'location',
    content: `设定内容${pad(25)}`,
    parentId: null,
    order: 1,
    tags: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

const volumes: VolumeDoc[] = [
  { id: 'vol-1', title: '第一卷', order: 1 },
  { id: 'vol-2', title: '第二卷', order: 2 },
  { id: 'vol-3', title: '第三卷', order: 3 }
]

const bookMeta: BookMeta = {
  id: 'book-1',
  name: '测试书',
  type: 'novel',
  formatVersion: 2,
  config: { wordCountGoal: 200000, dailyGoal: 2000, autoSave: true, autoSaveInterval: 30 },
  synopsis: `全书梗概 BOOK-SYNOPSIS-${pad(50)}`
}

const book: ContextBook = {
  meta: bookMeta,
  volumes,
  outlineNotes: `大纲笔记 OUTLINE-NOTES-${pad(60)}`,
  chapters: Array.from({ length: 30 }, (_, i) => {
    const n = i + 1
    const id = `ch-${String(n).padStart(2, '0')}`
    return {
      id,
      title: `第${n}章`,
      volumeId: n <= 10 ? 'vol-1' : n <= 20 ? 'vol-2' : 'vol-3',
      order: n
    }
  })
}

// 非当前章的“整章正文”哨兵：只存在于测试内存，绝不允许出现在装配输出里（红线 a）。
const otherBodies: Record<string, string> = Object.fromEntries(
  book.chapters
    .filter((c) => c.id !== CURRENT)
    .map((c) => [c.id, `SENTINEL-${c.id}-FULL-BODY-${pad(30)}`])
)

const CURRENT_BODY = `当前正文开头-${pad(90)}-当前正文结尾`

function baseInputs(over: Partial<ContextInputs> = {}): ContextInputs {
  return {
    book,
    currentChapterId: CURRENT,
    chapterBody: CURRENT_BODY,
    chapterSummaries: {
      'ch-11': `CH11-摘要-超出前三章窗口-${pad(40)}`,
      'ch-12': `CH12-摘要-${pad(40)}`,
      'ch-13': `CH13-摘要-${pad(40)}`,
      'ch-14': `CH14-摘要-${pad(40)}`,
      'ch-15': `CH15-摘要-当前章自身不应出现-${pad(40)}`
    },
    volumeSummaries: {
      'vol-1': `VOL1-梗概-非当前卷不应出现-${pad(40)}`,
      'vol-2': `VOL2-梗概-${pad(60)}`
    },
    entityIndex: {
      'char-01': ['ch-14', CURRENT],
      'char-02': [CURRENT],
      'char-03': [CURRENT, 'ch-20'],
      'char-04': [CURRENT],
      'char-05': [CURRENT],
      'char-06': ['ch-07'],
      'world-01': ['ch-08', CURRENT],
      'world-02': ['ch-09']
    },
    entityCards: {
      character: Array.from({ length: 20 }, (_, i) => makeCharacter(`char-${String(i + 1).padStart(2, '0')}`)),
      world: Array.from({ length: 10 }, (_, i) => makeWorld(`world-${String(i + 1).padStart(2, '0')}`))
    },
    budgetTokens: 100_000,
    ...over
  }
}

// ---------------------------------------------------------------------------
// estimateTokens 钉值
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('空串 → 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('CJK（含扩展 A / 兼容表意区）每字 1 token', () => {
    expect(estimateTokens('你好')).toBe(2)
    expect(estimateTokens('㐀')).toBe(1) // U+3400 扩展 A 起点
    expect(estimateTokens('豈')).toBe(1) // U+F900 兼容表意起点
  })

  it('非 CJK 每 4 字符 1 token（向上取整），空格计入余数', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('一二三 abcd')).toBe(5) // 3 CJK + ceil(5/4)=2
  })

  it('混合串钉值：「你好 Hello」= 2 + ceil(6/4) = 4（余数含空格，轻微高估，预算用途可接受）', () => {
    expect(estimateTokens('你好 Hello')).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 满预算：全层齐备 + 结构与消息形状
// ---------------------------------------------------------------------------

describe('assembleAiContext 满预算', () => {
  const inp = baseInputs()
  const out = assembleAiContext(inp)
  const system = out.messages[0].content
  const user = out.messages[1].content

  it('恰好两条消息：system 骨架在前，user 正文在后', () => {
    expect(out.messages).toHaveLength(2)
    expect(out.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(system.startsWith(ORGANIZE_SYSTEM_SKELETON)).toBe(true)
    expect(user.startsWith('【当前章节正文】\n')).toBe(true)
  })

  it('骨架声明「完美小说」的「设定管家」角色', () => {
    expect(ORGANIZE_SYSTEM_SKELETON).toContain('完美小说')
    expect(ORGANIZE_SYSTEM_SKELETON).toContain('设定管家')
  })

  it('四个上下文层按优先级顺序出现（位置断言，不钉全文）', () => {
    const pEntity = system.indexOf('【涉事实体卡】')
    const pChap = system.indexOf('【前三章摘要】')
    const pVol = system.indexOf('【当前卷梗概】')
    const pOutline = system.indexOf('【全书大纲】')
    expect(pEntity).toBeGreaterThan(-1)
    expect(pChap).toBeGreaterThan(pEntity)
    expect(pVol).toBeGreaterThan(pChap)
    expect(pOutline).toBeGreaterThan(pVol)
    expect(out.droppedFor).toEqual([])
    expect(out.estTokens).toBeLessThanOrEqual(inp.budgetTokens)
  })

  it('当前章正文完整出现在 user 消息中', () => {
    expect(user).toContain(CURRENT_BODY)
  })

  it('estTokens = 全部消息内容拼接后的估算值', () => {
    expect(out.estTokens).toBe(estimateTokens(out.messages.map((m) => m.content).join('')))
  })

  it('摘要层：仅 order 前驱且最近的 3 章，按升序呈现；当前章自身与 ch-11 不出现', () => {
    expect(system).toContain('CH12-摘要')
    expect(system).toContain('CH13-摘要')
    expect(system).toContain('CH14-摘要')
    expect(system.indexOf('CH12-摘要')).toBeLessThan(system.indexOf('CH13-摘要'))
    expect(system.indexOf('CH13-摘要')).toBeLessThan(system.indexOf('CH14-摘要'))
    expect(system).not.toContain('CH11-摘要')
    expect(system).not.toContain('CH15-摘要')
  })

  it('卷层：只含当前卷梗概', () => {
    expect(system).toContain('VOL2-梗概')
    expect(system).not.toContain('VOL1-梗概')
  })

  it('大纲层：synopsis + outlineNotes + 卷列表', () => {
    expect(system).toContain('BOOK-SYNOPSIS')
    expect(system).toContain('OUTLINE-NOTES')
    expect(system).toContain('vol-3')
  })
})

// ---------------------------------------------------------------------------
// 预算阶梯：droppedFor 精确序列（低优先级先丢）
// ---------------------------------------------------------------------------

describe('assembleAiContext 预算阶梯', () => {
  const full = assembleAiContext(baseInputs())
  const sys = full.messages[0].content
  const usr = full.messages[1].content

  // 预算 = 只保留 header 之前的层时的估算值（截到首个被丢层标题处，含尾随分隔，
  // 高估 ≤1 token → 保留层必然放得下；被丢层体量 ≥40 token → 必然放不下）。
  const budgetDropping = (firstDroppedHeader: string): number => {
    const idx = sys.indexOf(firstDroppedHeader)
    expect(idx).toBeGreaterThan(-1)
    return estimateTokens(sys.slice(0, idx) + usr)
  }

  const cases: { header: string; dropped: string[]; kept: string[]; gone: string[] }[] = [
    {
      header: '【全书大纲】',
      dropped: ['outline'],
      kept: ['【涉事实体卡】', '【前三章摘要】', '【当前卷梗概】'],
      gone: ['【全书大纲】']
    },
    {
      header: '【当前卷梗概】',
      dropped: ['outline', 'volume-summary'],
      kept: ['【涉事实体卡】', '【前三章摘要】'],
      gone: ['【当前卷梗概】', '【全书大纲】']
    },
    {
      header: '【前三章摘要】',
      dropped: ['outline', 'volume-summary', 'chapter-summaries'],
      kept: ['【涉事实体卡】'],
      gone: ['【前三章摘要】', '【当前卷梗概】', '【全书大纲】']
    },
    {
      header: '【涉事实体卡】',
      dropped: ['outline', 'volume-summary', 'chapter-summaries', 'entity-cards'],
      kept: [],
      gone: ['【涉事实体卡】', '【前三章摘要】', '【当前卷梗概】', '【全书大纲】']
    }
  ]

  for (const c of cases) {
    it(`预算 ${budgetDropping(c.header)} → droppedFor 精确为 [${c.dropped.join(', ')}]`, () => {
      const out = assembleAiContext(baseInputs({ budgetTokens: budgetDropping(c.header) }))
      expect(out.droppedFor).toEqual(c.dropped)
      const s = out.messages[0].content
      for (const h of c.kept) expect(s).toContain(h)
      for (const h of c.gone) expect(s).not.toContain(h)
      expect(out.estTokens).toBeLessThanOrEqual(budgetDropping(c.header))
      // 正文与骨架始终保底
      expect(s.startsWith(ORGANIZE_SYSTEM_SKELETON)).toBe(true)
      expect(out.messages[1].content).toContain(CURRENT_BODY)
    })
  }

  it('丢无可丢后全层出清 → system 恰为骨架', () => {
    const out = assembleAiContext(baseInputs({ budgetTokens: budgetDropping('【涉事实体卡】') }))
    expect(out.messages[0].content).toBe(ORGANIZE_SYSTEM_SKELETON)
  })
})

// ---------------------------------------------------------------------------
// 正文 80% 上限截断（独立场景：无任何可选层）
// ---------------------------------------------------------------------------

describe('正文超预算 80% → 截断保尾', () => {
  const longBody = `甲甲开头${'甲'.repeat(700)}${'乙'.repeat(100)}结尾乙乙`
  const inputs = (): ContextInputs =>
    baseInputs({
      chapterBody: longBody,
      chapterSummaries: {},
      volumeSummaries: {},
      entityIndex: {},
      entityCards: { character: [], world: [] },
      book: { ...book, meta: { ...bookMeta, synopsis: '' }, volumes: [], outlineNotes: '' },
      budgetTokens: 850
    })

  it('80% 上限触发：droppedFor 仅 body-truncated，system 只剩骨架', () => {
    const out = assembleAiContext(inputs())
    expect(out.droppedFor).toEqual(['body-truncated'])
    expect(out.messages[0].content).toBe(ORGANIZE_SYSTEM_SKELETON)
    expect(out.estTokens).toBeLessThanOrEqual(850)
  })

  it('保尾：截断后正文以原文结尾收尾，且不含原文头部', () => {
    const out = assembleAiContext(inputs())
    const user = out.messages[1].content
    expect(user.startsWith('【当前章节正文】\n…\n')).toBe(true)
    expect(user.endsWith(`${'乙'.repeat(100)}结尾乙乙`)).toBe(true)
    expect(user).not.toContain('甲甲开头')
    expect(user).not.toContain('甲'.repeat(700))
  })

  it('未超 80% 时绝不截断（满预算场景正文完整）', () => {
    const out = assembleAiContext(baseInputs())
    expect(out.droppedFor).not.toContain('body-truncated')
    expect(out.messages[1].content).toContain(CURRENT_BODY)
  })
})

// ---------------------------------------------------------------------------
// 极小预算：骨架 + 截断正文（丢序 body 记录在前，段层依次出清）
// ---------------------------------------------------------------------------

describe('极小预算退化', () => {
  it('budget=200 → 全段丢弃 + 正文压缩，droppedFor 精确（80% 上限先触发，故 body-truncated 在前）', () => {
    const out = assembleAiContext(
      baseInputs({ budgetTokens: 200, chapterBody: '尾'.repeat(400) })
    )
    expect(out.droppedFor).toEqual([
      'body-truncated',
      'outline',
      'volume-summary',
      'chapter-summaries',
      'entity-cards'
    ])
    expect(out.messages[0].content).toBe(ORGANIZE_SYSTEM_SKELETON)
    expect(out.messages[1].content.startsWith('【当前章节正文】\n…\n')).toBe(true)
    expect(out.messages[1].content).toContain('尾') // 压缩后仍保有一段正文（预算可行）
    expect(out.estTokens).toBeLessThanOrEqual(200)
  })

  it('预算低于骨架固有开销 → 骨架绝不丢弃（退化但结构合法）', () => {
    const out = assembleAiContext(
      baseInputs({ budgetTokens: 40, chapterBody: '尾'.repeat(400) })
    )
    expect(out.messages[0].content).toBe(ORGANIZE_SYSTEM_SKELETON)
    expect(out.messages[1].content).toBe('【当前章节正文】\n…\n') // 正文压缩至空
    expect(out.droppedFor[0]).toBe('body-truncated')
  })
})

// ---------------------------------------------------------------------------
// 红线
// ---------------------------------------------------------------------------

describe('红线：绝不引入非当前章正文 / 非涉事实体卡', () => {
  const out = assembleAiContext(baseInputs())
  const all = out.messages.map((m) => m.content).join('')

  it('(a) 输出不含任何非当前章正文哨兵子串', () => {
    expect(all).not.toContain('SENTINEL-')
    for (const [id, body] of Object.entries(otherBodies)) {
      expect(body.length).toBeGreaterThan(0)
      expect(all).not.toContain(`SENTINEL-${id}`)
      expect(all).not.toContain(body.slice(0, 12))
    }
    expect(all).not.toContain(otherBodies['ch-30'])
  })

  it('(b) 仅 entityIndex 命中当前章的卡片出现；未命中卡片（含其 id）绝不出现', () => {
    for (const id of ['char-01', 'char-02', 'char-03', 'char-04', 'char-05', 'world-01']) {
      expect(all).toContain(id)
    }
    const uncited = [
      ...['char-06', 'char-07', 'char-08', 'char-15', 'char-20'].map((i) => i),
      ...['world-02', 'world-03', 'world-10']
    ]
    for (const id of uncited) expect(all).not.toContain(id)
  })

  it('entityIndex 无当前章命中 → 实体卡层整体缺席（M4b 未建索引时的合法状态）', () => {
    const out2 = assembleAiContext(
      baseInputs({ entityIndex: { 'char-01': ['ch-07'], 'world-01': ['ch-08'] } })
    )
    expect(out2.messages[0].content).not.toContain('【涉事实体卡】')
    expect(out2.droppedFor).toEqual([])
  })

  it('index 命中但卡池中不存在的 id → 不产生卡片、不报错', () => {
    const out2 = assembleAiContext(baseInputs({ entityIndex: { 'ghost-99': [CURRENT] } }))
    expect(out2.messages[0].content).not.toContain('ghost-99')
    expect(out2.messages[0].content).not.toContain('【涉事实体卡】')
  })
})

// ---------------------------------------------------------------------------
// 空输入退化 + 确定性
// ---------------------------------------------------------------------------

describe('空输入退化', () => {
  it('无摘要/无索引/无卡池/无卷梗概 → 仍产出合法骨架+正文（仅剩大纲层）', () => {
    const out = assembleAiContext(
      baseInputs({
        chapterSummaries: {},
        volumeSummaries: {},
        entityIndex: {},
        entityCards: { character: [], world: [] }
      })
    )
    expect(out.droppedFor).toEqual([])
    expect(out.messages[0].content.startsWith(ORGANIZE_SYSTEM_SKELETON)).toBe(true)
    expect(out.messages[0].content).not.toContain('【涉事实体卡】')
    expect(out.messages[0].content).not.toContain('【前三章摘要】')
    expect(out.messages[0].content).not.toContain('【当前卷梗概】')
    expect(out.messages[0].content).toContain('【全书大纲】')
    expect(out.messages[1].content).toContain(CURRENT_BODY)
  })

  it('大纲也无内容（空卷列表/synopsis/notes）→ system 恰为骨架', () => {
    const out = assembleAiContext(
      baseInputs({
        chapterSummaries: {},
        volumeSummaries: {},
        entityIndex: {},
        entityCards: { character: [], world: [] },
        book: { ...book, meta: { ...bookMeta, synopsis: '' }, volumes: [], outlineNotes: '' }
      })
    )
    expect(out.messages[0].content).toBe(ORGANIZE_SYSTEM_SKELETON)
    expect(out.droppedFor).toEqual([])
  })

  it('currentChapterId 不在书目中 → 无前驱/无当前卷，仅实体卡+大纲可出现', () => {
    const out = assembleAiContext(
      baseInputs({ currentChapterId: 'ch-99', entityIndex: { 'char-01': ['ch-99'] } })
    )
    expect(out.messages[0].content).not.toContain('【前三章摘要】')
    expect(out.messages[0].content).not.toContain('【当前卷梗概】')
    expect(out.messages[0].content).toContain('【涉事实体卡】') // 索引命中不依赖书目
  })
})

describe('确定性', () => {
  it('同一输入两次装配 → 输出逐字段一致', () => {
    const a = assembleAiContext(baseInputs())
    const b = assembleAiContext(baseInputs())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('卡池乱序不影响输出（按 kind+id 排序序列化）', () => {
    const inp = baseInputs()
    const shuffled = baseInputs({
      entityCards: {
        character: [...inp.entityCards.character].reverse(),
        world: [...inp.entityCards.world].reverse()
      }
    })
    expect(assembleAiContext(shuffled).messages[0].content).toBe(
      assembleAiContext(inp).messages[0].content
    )
  })
})

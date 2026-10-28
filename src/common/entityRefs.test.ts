// buildEntityChapterRefs 测试（M4c-2 Task 2：实体→章节引用并集的纯函数）。
// 钉死四条口径（计划裁定）：
// 1) 键域 = 所有实体 id（角色/词条/剧情线/选项/伏笔），无任何引用的实体给 []；
// 2) 每个实体的引用 = index（AI 维护 .ai/index.json）∪ 显式字段（arc/stages/chapterId/伏笔章）去重；
// 3) 剔除不在 orderedChapterIds 的悬挂引用（章节已删除）；
// 4) 输出数组按 orderedChapterIds 中的位置排序（书序），与入参出现次序无关。
import { describe, expect, it } from 'vitest'
import { buildEntityChapterRefs } from './entityRefs'
import type {
  CharacterV2,
  ChoiceNodeV2,
  ForeshadowLedger,
  PlotlineV2,
  WorldEntryV2
} from './schema'

// 固定 UUID：章节 ch1..ch5（书序即编号序），fsGone 不在书序（模拟已删章）
const CH_1 = '11111111-1111-4111-8111-111111111111'
const CH_2 = '22222222-2222-4222-8222-222222222222'
const CH_3 = '33333333-3333-4333-8333-333333333333'
const CH_4 = '44444444-4444-4444-8444-444444444444'
const CH_5 = '55555555-5555-4555-8555-555555555555'
const CH_GONE = '66666666-6666-4666-8666-666666666666'
const CHAR_ID = 'a1000000-0000-4000-8000-000000000001'
const WORLD_ID = 'b2000000-0000-4000-8000-000000000002'
const PLOT_ID = 'c3000000-0000-4000-8000-000000000003'
const CHOICE_ID = 'd4000000-0000-4000-8000-000000000004'
const FS_ID = 'e5000000-0000-4000-8000-000000000005'

const NOW = '2026-10-28T00:00:00.000Z'

/** 默认书序（多数用例共用）；ch1..ch5。 */
const BOOK = [CH_1, CH_2, CH_3, CH_4, CH_5]

function character(arcChapterIds: string[][]): CharacterV2 {
  return {
    id: CHAR_ID,
    name: '林晚',
    gender: 'female',
    age: 28,
    role: 'protagonist',
    appearance: '',
    personality: '',
    background: '',
    relationships: [],
    arc: arcChapterIds.map((chapterIds, i) => ({
      title: `阶段${i}`,
      summary: '',
      chapterIds
    })),
    tags: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function worldEntry(): WorldEntryV2 {
  return {
    id: WORLD_ID,
    title: '雾岭',
    category: 'location',
    content: '',
    parentId: null,
    order: 0,
    tags: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function plotline(stageChapterIds: string[][]): PlotlineV2 {
  return {
    id: PLOT_ID,
    title: '复仇线',
    summary: '',
    status: 'active',
    stages: stageChapterIds.map((chapterIds, i) => ({
      title: `幕${i}`,
      summary: '',
      chapterIds,
      entityIds: []
    })),
    createdAt: NOW,
    updatedAt: NOW
  }
}

function choice(chapterId: string): ChoiceNodeV2 {
  return {
    id: CHOICE_ID,
    title: '是否开门',
    chapterId,
    options: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function ledger(
  plantedChapterId: string,
  resolvedChapterId: string | null
): ForeshadowLedger {
  return {
    entries: [
      {
        id: FS_ID,
        title: '老剑的秘密',
        plantedChapterId,
        plannedPayoffNote: '',
        resolvedChapterId,
        status: resolvedChapterId ? 'resolved' : 'open'
      }
    ]
  }
}

/** 五域各恰好一个实体的空引用底座（显式引用全空）。 */
const EMPTY_ARGS = {
  index: {},
  characters: [character([])],
  world: [worldEntry()],
  plotlines: [plotline([])],
  choices: [] as ChoiceNodeV2[],
  ledger: { entries: [] } as ForeshadowLedger,
  orderedChapterIds: BOOK
}

describe('buildEntityChapterRefs——并集/去重', () => {
  it('index 与显式引用取并集并去重，结果按书序', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_1, CH_3] },
      characters: [character([[CH_2, CH_3]])]
    })
    expect(refs[CHAR_ID]).toEqual([CH_1, CH_2, CH_3])
  })

  it('键域 = 所有实体 id；两路皆空的实体给 []', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      world: [worldEntry()],
      choices: [choice(CH_GONE)] // 显式引用全悬挂
    })
    expect(Object.keys(refs).sort()).toEqual([CHAR_ID, WORLD_ID, PLOT_ID, CHOICE_ID].sort())
    expect(refs[CHAR_ID]).toEqual([])
    expect(refs[WORLD_ID]).toEqual([])
    expect(refs[PLOT_ID]).toEqual([])
    expect(refs[CHOICE_ID]).toEqual([])
  })

  it('index 中不存在于键域的实体 id 被忽略（已删实体不复活）', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [FS_ID]: [CH_1] } // ledger 为空，FS_ID 不是任何实体
    })
    expect(refs[FS_ID]).toBeUndefined()
  })
})

describe('buildEntityChapterRefs——悬挂剔除', () => {
  it('index 里的已删章节被剔除，同实体有效引用保留', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_1, CH_GONE, CH_3] }
    })
    expect(refs[CHAR_ID]).toEqual([CH_1, CH_3])
  })

  it('orderedChapterIds 为空（删无可删的书）→ 所有实体引用清空但键仍在', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_1] },
      characters: [character([[CH_2]])],
      orderedChapterIds: []
    })
    expect(refs[CHAR_ID]).toEqual([])
  })
})

describe('buildEntityChapterRefs——来源缺省形态', () => {
  it('空 index（M4b 前存量书）→ 只剩显式引用', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: {},
      characters: [character([[CH_3], [CH_1, CH_3]])], // 两段 arc，跨段去重
      plotlines: [plotline([[CH_2]])]
    })
    expect(refs[CHAR_ID]).toEqual([CH_1, CH_3])
    expect(refs[PLOT_ID]).toEqual([CH_2])
  })

  it('空显式引用（新书未写 arc）→ 只剩 index 引用', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_2, CH_1] }
    })
    expect(refs[CHAR_ID]).toEqual([CH_1, CH_2]) // 仍按书序
  })

  it('两路皆空且无任何实体 → {}', () => {
    const refs = buildEntityChapterRefs({
      index: {},
      characters: [],
      world: [],
      plotlines: [],
      choices: [],
      ledger: { entries: [] },
      orderedChapterIds: BOOK
    })
    expect(refs).toEqual({})
  })
})

describe('buildEntityChapterRefs——各实体域的显式来源', () => {
  it('排序跟随 orderedChapterIds 书序，而非入参出现序', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_5, CH_1, CH_3] },
      characters: [character([[CH_4, CH_2]])],
      orderedChapterIds: [CH_5, CH_3, CH_1, CH_4, CH_2] // 乱序书序
    })
    expect(refs[CHAR_ID]).toEqual([CH_5, CH_3, CH_1, CH_4, CH_2])
  })

  it('world 词条无显式章节字段（schema v2 如此），引用只来自 index', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [WORLD_ID]: [CH_2] },
      world: [worldEntry()]
    })
    expect(refs[WORLD_ID]).toEqual([CH_2])
  })

  it('plotline 展平多 stages 的 chapterIds 并入 index', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [PLOT_ID]: [CH_4] },
      plotlines: [plotline([[CH_1, CH_2], [], [CH_2, CH_3]])]
    })
    expect(refs[PLOT_ID]).toEqual([CH_1, CH_2, CH_3, CH_4])
  })

  it('choice 的 chapterId 计入引用', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      choices: [choice(CH_3)]
    })
    expect(refs[CHOICE_ID]).toEqual([CH_3])
  })

  it('foreshadow = planted ∪ resolved（null 剔除），并与 index 并集', () => {
    const resolved = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index: { [FS_ID]: [CH_1] }, // 与 planted 同章 → 去重
      ledger: ledger(CH_1, CH_4)
    })
    expect(resolved[FS_ID]).toEqual([CH_1, CH_4])

    const unresolved = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      ledger: ledger(CH_1, null)
    })
    expect(unresolved[FS_ID]).toEqual([CH_1])
  })

  it('foreshadow 的悬挂 resolved 被剔除、planted 保留', () => {
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      ledger: ledger(CH_2, CH_GONE)
    })
    expect(refs[FS_ID]).toEqual([CH_2])
  })
})

describe('buildEntityChapterRefs——纯函数纪律', () => {
  it('同输入两次调用结果深相等（确定性）', () => {
    const args = {
      ...EMPTY_ARGS,
      index: { [CHAR_ID]: [CH_3, CH_1] },
      characters: [character([[CH_2, CH_3]])],
      plotlines: [plotline([[CH_5], [CH_4]])]
    }
    expect(buildEntityChapterRefs(args)).toEqual(buildEntityChapterRefs(args))
  })

  it('不改动入参（index/arc 数组冻结仍可通过）', () => {
    const indexArr: string[] = [CH_3, CH_1]
    Object.freeze(indexArr)
    const index: Record<string, string[]> = { [CHAR_ID]: indexArr }
    Object.freeze(index)
    const arcChapters: string[] = [CH_2]
    Object.freeze(arcChapters)
    const refs = buildEntityChapterRefs({
      ...EMPTY_ARGS,
      index,
      characters: [character([arcChapters])]
    })
    expect(refs[CHAR_ID]).toEqual([CH_1, CH_2, CH_3])
    expect(indexArr).toEqual([CH_3, CH_1])
  })
})

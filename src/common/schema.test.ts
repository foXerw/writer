import { describe, it, expect } from 'vitest'
import {
  FORMAT_VERSION,
  validateBookMeta,
  validateVolumeDoc,
  validateChapterMeta,
  validateEntityLink,
  validateCharacterV2,
  validateWorldEntryV2,
  validatePlotlineV2,
  validateChoiceNodeV2,
  validateForeshadowEntry,
  validateForeshadowLedger
} from './schema'

// 固定合法 UUID，供各测试复用
const UUID_A = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function validCharacter(): Record<string, unknown> {
  return {
    id: UUID_A,
    name: '林晚',
    gender: 'female',
    age: 24,
    role: 'protagonist',
    appearance: '黑发及腰',
    personality: '冷静',
    background: '边陲小镇',
    relationships: [{ targetId: UUID_B, kind: 'rival' }],
    arc: [{ title: '觉醒', summary: '从沉默到反抗', chapterIds: [UUID_B] }],
    tags: [{ id: 'tag-1', name: '傲娇', color: '#ff0000' }],
    links: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('FORMAT_VERSION', () => {
  it('常量等于 2', () => {
    expect(FORMAT_VERSION).toBe(2)
  })
})

describe('validateCharacterV2', () => {
  it('接受最小合法对象，返回 []', () => {
    expect(validateCharacterV2(validCharacter())).toEqual([])
  })

  it('可选字段 avatar/goals/flaws/notes 缺省时仍合法', () => {
    const v = validCharacter()
    expect(validateCharacterV2(v)).toEqual([])
  })

  it('缺少 name 时错误串包含 "name"', () => {
    const v = validCharacter()
    delete v.name
    const errors = validateCharacterV2(v)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('name'))).toBe(true)
  })

  it('role 为枚举外值 "god" 时错误串包含 "role"', () => {
    const v = validCharacter()
    v.role = 'god'
    const errors = validateCharacterV2(v)
    expect(errors.some((e) => e.includes('role'))).toBe(true)
  })

  it('gender 为枚举外值时报错包含 "gender"', () => {
    const v = validCharacter()
    v.gender = 'none'
    expect(validateCharacterV2(v).some((e) => e.includes('gender'))).toBe(true)
  })

  it('id 不是 UUID 时报错包含 "id"', () => {
    const v = validCharacter()
    v.id = 'char_1'
    expect(validateCharacterV2(v).some((e) => e.includes('id'))).toBe(true)
  })

  it('age 非数字时报错包含 "age"', () => {
    const v = validCharacter()
    v.age = '24'
    expect(validateCharacterV2(v).some((e) => e.includes('age'))).toBe(true)
  })

  it('relationships 元素缺 kind 时报错包含 "relationships"', () => {
    const v = validCharacter()
    v.relationships = [{ targetId: UUID_B }]
    const errors = validateCharacterV2(v)
    expect(errors.some((e) => e.includes('relationships') && e.includes('kind'))).toBe(true)
  })

  it('arc 元素 chapterIds 非字符串数组时报错包含 "arc"', () => {
    const v = validCharacter()
    v.arc = [{ title: '觉醒', summary: 's', chapterIds: 'not-an-array' }]
    expect(validateCharacterV2(v).some((e) => e.includes('arc'))).toBe(true)
  })

  it('未知多余字段被容忍（向前兼容）', () => {
    const v = validCharacter()
    v.futureField = { whatever: true }
    expect(validateCharacterV2(v)).toEqual([])
  })

  it('非对象输入返回非空错误', () => {
    expect(validateCharacterV2(null).length).toBeGreaterThan(0)
    expect(validateCharacterV2('x').length).toBeGreaterThan(0)
  })
})

describe('validateBookMeta', () => {
  function validBookMeta(): Record<string, unknown> {
    return {
      id: UUID_A,
      name: '完美小说',
      type: 'novel',
      formatVersion: FORMAT_VERSION,
      config: { wordCountGoal: 500000, dailyGoal: 2000, autoSave: true, autoSaveInterval: 30 },
      synopsis: '一句话梗概'
    }
  }

  it('合法对象返回 []', () => {
    expect(validateBookMeta(validBookMeta())).toEqual([])
  })

  it('type 非法时报错包含 "type"', () => {
    const v = validBookMeta()
    v.type = 'manga'
    expect(validateBookMeta(v).some((e) => e.includes('type'))).toBe(true)
  })

  it('formatVersion 非 2 时报错包含 "formatVersion"', () => {
    const v = validBookMeta()
    v.formatVersion = 1
    expect(validateBookMeta(v).some((e) => e.includes('formatVersion'))).toBe(true)
  })

  it('config 缺字段时报错包含 "config"', () => {
    const v = validBookMeta()
    v.config = { wordCountGoal: 1 }
    expect(validateBookMeta(v).some((e) => e.includes('config'))).toBe(true)
  })
})

describe('validateVolumeDoc / validateChapterMeta', () => {
  it('合法卷返回 []', () => {
    expect(validateVolumeDoc({ id: UUID_A, title: '第一卷', order: 1 })).toEqual([])
  })

  it('卷 order 非数字报错包含 "order"', () => {
    expect(
      validateVolumeDoc({ id: UUID_A, title: 'v', order: 'first' }).some((e) => e.includes('order'))
    ).toBe(true)
  })

  it('chapterMeta 允许 volumeId 为 null', () => {
    expect(
      validateChapterMeta({
        id: UUID_A,
        title: '第一章',
        volumeId: null,
        order: 0,
        status: 'draft'
      })
    ).toEqual([])
  })

  it('chapterMeta 非法 status 报错包含 "status"', () => {
    expect(
      validateChapterMeta({
        id: UUID_A,
        title: 'c',
        volumeId: UUID_B,
        order: 0,
        status: 'locked'
      }).some((e) => e.includes('status'))
    ).toBe(true)
  })

  it('chapterMeta volumeId 非 string|null 报错包含 "volumeId"', () => {
    expect(
      validateChapterMeta({
        id: UUID_A,
        title: 'c',
        volumeId: 42,
        order: 0,
        status: 'draft'
      }).some((e) => e.includes('volumeId'))
    ).toBe(true)
  })
})

describe('validateEntityLink', () => {
  it('最小合法返回 []', () => {
    expect(validateEntityLink({ targetId: UUID_A, kind: 'friend' })).toEqual([])
  })

  it('缺 targetId 报错包含 "targetId"', () => {
    expect(validateEntityLink({ kind: 'friend' }).some((e) => e.includes('targetId'))).toBe(true)
  })
})

describe('validateWorldEntryV2', () => {
  it('合法条目返回 []', () => {
    expect(
      validateWorldEntryV2({
        id: UUID_A,
        title: '云梦泽',
        category: 'location',
        content: '大泽',
        parentId: null,
        order: 1,
        tags: ['水域'],
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toEqual([])
  })

  it('category 非法报错包含 "category"', () => {
    const v = {
      id: UUID_A,
      title: 'x',
      category: 'technology',
      content: '',
      parentId: null,
      order: 0,
      tags: [],
      links: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(validateWorldEntryV2(v).some((e) => e.includes('category'))).toBe(true)
  })
})

describe('validatePlotlineV2', () => {
  function validPlotline(): Record<string, unknown> {
    return {
      id: UUID_A,
      title: '复仇线',
      summary: '主线',
      status: 'active',
      stages: [{ title: '起因', summary: 's', chapterIds: [UUID_B], entityIds: [UUID_A] }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }

  it('合法返回 []', () => {
    expect(validatePlotlineV2(validPlotline())).toEqual([])
  })

  it('stage 缺 title 时报错（包含 "title"）', () => {
    const v = validPlotline()
    v.stages = [{ summary: 's', chapterIds: [], entityIds: [] }]
    const errors = validatePlotlineV2(v)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('title'))).toBe(true)
  })

  it('status 非法报错包含 "status"', () => {
    const v = validPlotline()
    v.status = 'paused'
    expect(validatePlotlineV2(v).some((e) => e.includes('status'))).toBe(true)
  })
})

describe('validateChoiceNodeV2', () => {
  it('合法返回 []', () => {
    expect(
      validateChoiceNodeV2({
        id: UUID_A,
        title: '抉择',
        chapterId: UUID_B,
        options: [{ label: '向左', consequence: '遇伏' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toEqual([])
  })

  it('options 元素缺 label 报错包含 "options"', () => {
    expect(
      validateChoiceNodeV2({
        id: UUID_A,
        title: 'n',
        chapterId: UUID_B,
        options: [{ consequence: 'x' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }).some((e) => e.includes('options') && e.includes('label'))
    ).toBe(true)
  })
})

describe('validateForeshadowEntry / validateForeshadowLedger', () => {
  it('空账本返回 []', () => {
    expect(validateForeshadowLedger({ entries: [] })).toEqual([])
  })

  it('合法条目返回 []', () => {
    expect(
      validateForeshadowEntry({
        id: UUID_A,
        title: '玉佩来历',
        plantedChapterId: UUID_B,
        plannedPayoffNote: '第 30 章',
        resolvedChapterId: null,
        status: 'open'
      })
    ).toEqual([])
  })

  it('status 非法报错包含 "status"', () => {
    expect(
      validateForeshadowEntry({
        id: UUID_A,
        title: 't',
        plantedChapterId: UUID_B,
        plannedPayoffNote: '',
        resolvedChapterId: null,
        status: 'pending'
      }).some((e) => e.includes('status'))
    ).toBe(true)
  })

  it('账本内坏条目被拒绝且错误定位到 entries', () => {
    const errors = validateForeshadowLedger({
      entries: [
        {
          id: 'not-a-uuid',
          title: 't',
          plantedChapterId: UUID_B,
          plannedPayoffNote: '',
          resolvedChapterId: null,
          status: 'open'
        }
      ]
    })
    expect(errors.some((e) => e.includes('entries') && e.includes('id'))).toBe(true)
  })

  it('entries 非数组报错包含 "entries"', () => {
    expect(validateForeshadowLedger({ entries: 'oops' }).some((e) => e.includes('entries'))).toBe(
      true
    )
  })
})

// M5 Task 1 契约测试：补全上下文装配器（纯函数、零 I/O）。
// 钉死：卡投影的码点截断（不劈代理对）与空字段跳过；章节反查按 key 字典序的确定性；
// prompt 骨架「卡在前、正文在后」+ 无卡自由续写授权句；光标前保尾 / 光标后保头 200；
// 空块（卡/梗概/光标后/零预算）一律省略，不产 dangling 段标题。
import { describe, expect, it } from 'vitest'
import type { CharacterV2, WorldEntryV2 } from './schema'
import type { CompletionPromptArgs } from './completionContext'
import {
  buildCompletionPrompt,
  entitiesForChapter,
  projectCharacterCard,
  projectWorldCard
} from './completionContext'

const NOW = '2026-10-31T00:00:00.000Z'

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
    createdAt: NOW,
    updatedAt: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function baseArgs(overrides: Partial<CompletionPromptArgs> = {}): CompletionPromptArgs {
  return {
    proseBefore: '海雾漫过甲板，',
    proseAfter: '灯塔第三层熄了。',
    cards: [
      '沈孤鸿（protagonist）：一袭青衫／外冷内热／剑阁遗孤',
      '极光塔（location）：悬浮于北境的金属巨塔。'
    ],
    bookName: '山海拾遗',
    synopsis: '少年提灯入海。',
    maxChars: 2000,
    ...overrides
  }
}

describe('projectCharacterCard', () => {
  it('全字段卡：name（role）：appearance／personality／background', () => {
    expect(projectCharacterCard(makeCharacter())).toBe('沈孤鸿（protagonist）：一袭青衫／外冷内热／剑阁遗孤')
  })

  it('长字段截到 80 码点，第 81 字绝不入卡', () => {
    const card = projectCharacterCard(makeCharacter({ appearance: '外'.repeat(100) }))
    expect(card).toContain('外'.repeat(80))
    expect(card).not.toContain('外'.repeat(81))
  })

  it('截断按码点而非 UTF-16 码元：emoji（代理对）不被劈开', () => {
    const card = projectCharacterCard(makeCharacter({ personality: '🙂'.repeat(90) }))
    expect(card).toContain('🙂'.repeat(80))
    expect(card).not.toContain('🙂'.repeat(81))
  })

  it('空字段跳过：不产生空段与连缀斜杠', () => {
    expect(projectCharacterCard(makeCharacter({ personality: '' }))).toBe('沈孤鸿（protagonist）：一袭青衫／剑阁遗孤')
    expect(projectCharacterCard(makeCharacter({ background: '   ' }))).toBe('沈孤鸿（protagonist）：一袭青衫／外冷内热')
  })

  it('三字段全空：只剩 name（role），不带冒号', () => {
    expect(projectCharacterCard(makeCharacter({ appearance: '', personality: '', background: '' }))).toBe(
      '沈孤鸿（protagonist）'
    )
  })
})

describe('projectWorldCard', () => {
  it('卡面：title（category）：content', () => {
    expect(projectWorldCard(makeWorld())).toBe('极光塔（location）：悬浮于北境的金属巨塔。')
  })

  it('content 截到 120 码点，第 121 字绝不入卡', () => {
    const card = projectWorldCard(makeWorld({ content: '设'.repeat(150) }))
    expect(card).toContain('设'.repeat(120))
    expect(card).not.toContain('设'.repeat(121))
  })

  it('content 为空：只剩 title（category），不带冒号', () => {
    expect(projectWorldCard(makeWorld({ content: '' }))).toBe('极光塔（location）')
  })
})

describe('entitiesForChapter', () => {
  it('反查 value 含目标章的 key，按字典序（确定性）', () => {
    const refs: Record<string, string[]> = {
      'plot-b': ['ch-1', 'ch-2'],
      'char-a': ['ch-2'],
      'world-c': [],
      'line-d': ['ch-2', 'ch-3']
    }
    expect(entitiesForChapter(refs, 'ch-2')).toEqual(['char-a', 'line-d', 'plot-b'])
  })

  it('无命中返回空数组', () => {
    expect(entitiesForChapter({ 'char-a': ['ch-1'] }, 'ch-9')).toEqual([])
  })
})

describe('buildCompletionPrompt', () => {
  it('system 含想象力兜底句：无卡时自由续写但不违设定', () => {
    const out = buildCompletionPrompt(baseArgs({ cards: [] }))
    expect(out.system).toContain('无卡时依正文语气自由续写，但不得与已给设定矛盾')
  })

  it('user 结构：设定卡块先于正文块，收尾是指令句', () => {
    const { user } = buildCompletionPrompt(baseArgs())
    expect(user.indexOf('【相关设定】')).toBeLessThan(user.indexOf('【正文·光标前】'))
    expect(user).toContain('【书名】山海拾遗')
    expect(user).toContain('【梗概】少年提灯入海。')
    expect(user).toContain('沈孤鸿（protagonist）：一袭青衫／外冷内热／剑阁遗孤\n极光塔（location）：悬浮于北境的金属巨塔。')
    expect(user.endsWith('请接续光标处写 ≤3 句（≤120 字），遇段落意思完整即停。')).toBe(true)
  })

  it('proseBefore 超 maxChars：只留尾部，头部出局', () => {
    const before = '甲'.repeat(50) + '乙'.repeat(30)
    const { user } = buildCompletionPrompt(baseArgs({ proseBefore: before, maxChars: 30 }))
    expect(user).toContain('乙'.repeat(30))
    expect(user).not.toContain('甲')
  })

  it('proseAfter 截头 200 字', () => {
    const { user } = buildCompletionPrompt(baseArgs({ proseAfter: '丙'.repeat(250) }))
    expect(user).toContain('丙'.repeat(200))
    expect(user).not.toContain('丙'.repeat(201))
  })

  it('空块省略：无卡/无梗概/光标后为空/零预算时不留 dangling 段标题', () => {
    const { user } = buildCompletionPrompt(
      baseArgs({ cards: [], synopsis: '   ', proseAfter: '', proseBefore: '甲乙', maxChars: 0 })
    )
    expect(user).not.toContain('【相关设定】')
    expect(user).not.toContain('【梗概】')
    expect(user).not.toContain('【光标后余文】')
    expect(user).not.toContain('【正文·光标前】')
  })

  it('确定性：同入参两次装配逐字段相等', () => {
    expect(buildCompletionPrompt(baseArgs())).toEqual(buildCompletionPrompt(baseArgs()))
  })
})

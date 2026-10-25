// v2 人物卡仓库测试（Task 6）：tmp 书目录 + 真实文件系统，钉死控制器裁定 1 的「新边 vs 旧边」三件套——
// (a) 新增指向存在角色/卷/世界观词条的边 → 成功；(b) 新增指向不存在 id 的边 → REF_BROKEN 且磁盘零改动；
// (c) 存量悬挂边 + 编辑其他字段 → 保存成功且悬挂边原样保留（删除他人后其卡绝不因旧边被锁死）。
// 守卫镜像 chapters/volumes：BAD_CHARACTER_ID（delete 幂等 false）/ CHARACTER_MISSING /
// CHARACTER_NAME_INVALID（仅名字变化时校验）/ CHARACTER_INVALID（写前校验、点读抛穿、列表侧 warn+跳过）；
// updatedAt 由仓库刷新、createdAt 以存量为准；delete 不级联（他人 edges 原样，M4 再治）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../tests/tmp'
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter
} from './characters'
import { characterFile, charactersDir, worldEntryFile } from './paths'
import { readYamlFile, writeYamlFileAtomic } from './docStore'
import { createVolume } from './volumes'
import { createChapter } from './chapters'
import { UUID_PATTERN, validateCharacterV2 } from '../../../src/common/schema'
import type { CharacterV2 } from '../../../src/common/schema'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function seed(name: string): { name: string; gender: 'male'; role: 'supporting' } {
  return { name, gender: 'male', role: 'supporting' }
}

/** 手造「存量悬挂边」卡：写盘绕开 create 的引用检查（模拟「对方后来被删」的既成事实）。 */
function plantWithDangling(p: string, name: string, targetId: string): CharacterV2 {
  const card = createCharacter(p, seed(name))
  const doc: CharacterV2 = {
    ...card,
    relationships: [{ targetId, kind: '恩人', note: '旧账' }]
  }
  writeYamlFileAtomic(characterFile(p, card.id), doc)
  return doc
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// create + list
// ---------------------------------------------------------------------------

describe('createCharacter + listCharacters', () => {
  it('create 落盘 characters/<uuid>.yaml：默认空字段 + ISO 时间戳，过 validateCharacterV2', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, { name: '阿明', gender: 'male', role: 'protagonist' })

    expect(c.id).toMatch(UUID_PATTERN)
    expect(c.name).toBe('阿明')
    expect(c.age).toBe(0)
    expect(c.appearance).toBe('')
    expect(c.relationships).toEqual([])
    expect(c.arc).toEqual([])
    expect(c.tags).toEqual([])
    expect(c.links).toEqual([])
    expect(c.createdAt).toMatch(ISO_RE)
    expect(c.updatedAt).toMatch(ISO_RE)
    expect(validateCharacterV2(readYamlFile<unknown>(characterFile(p, c.id)))).toEqual([])
    expect(readYamlFile<CharacterV2>(characterFile(p, c.id))).toEqual(c)
  })

  it('create 第三参 init 覆盖：额外字段随新建一次落盘；init 带幻影边同样被引用检查拒', () => {
    const p = mkTmpBook()
    const other = createCharacter(p, seed('乙'))
    const c = createCharacter(p, seed('甲'), {
      appearance: '黑发',
      goals: '复仇',
      relationships: [{ targetId: other.id, kind: '仇敌' }]
    })
    expect(c.appearance).toBe('黑发')
    expect(c.goals).toBe('复仇')
    expect(c.relationships).toEqual([{ targetId: other.id, kind: '仇敌' }])
    expect(readYamlFile<CharacterV2>(characterFile(p, c.id)).goals).toBe('复仇')

    expect(() =>
      createCharacter(p, seed('丙'), { links: [{ targetId: randomUUID(), kind: '指向幻影' }] })
    ).toThrow(/^REF_BROKEN: /)
    expect(listCharacters(p).map((x) => x.id)).toEqual([other.id, c.id])
  })

  it('create 空白/含换行名字 → CHARACTER_NAME_INVALID（回显名字）且零落盘', () => {
    const p = mkTmpBook()
    expect(() => createCharacter(p, seed('  '))).toThrow('CHARACTER_NAME_INVALID:   ')
    expect(() => createCharacter(p, seed('甲\r\n乙'))).toThrow('CHARACTER_NAME_INVALID: 甲\r\n乙')
    expect(existsSync(charactersDir(p))).toBe(false)
  })

  it('list 按 createdAt 升序（同刻按 stem）；stem 与 doc.id 不一致时以文件名为准', () => {
    const p = mkTmpBook()
    const newId = randomUUID()
    const oldId = randomUUID()
    const base = createCharacter(p, seed('基'))
    const mk = (id: string, createdAt: string): CharacterV2 => ({
      ...base,
      id,
      name: id.slice(0, 4),
      createdAt,
      updatedAt: createdAt
    })
    // doc.id 与 stem 故意错置：stem = 权威
    writeYamlFileAtomic(characterFile(p, newId), mk('ffffffff-0000-4000-8000-000000000000', '2020-01-01T00:00:00.000Z'))
    writeYamlFileAtomic(characterFile(p, oldId), mk('eeeeeeee-0000-4000-8000-000000000000', '2010-01-01T00:00:00.000Z'))

    const list = listCharacters(p)
    expect(list.map((c) => c.id)).toEqual([oldId, newId, base.id]) // 2010 < 2020 < 基(2026)
  })

  it('坏人物档（校验不过）list 时 console.warn + 跳过，绝不整体抛', () => {
    const p = mkTmpBook()
    const good = createCharacter(p, seed('完好'))
    mkdirSync(charactersDir(p), { recursive: true })
    writeFileSync(join(charactersDir(p), 'broken.yaml'), 'id: 不是uuid\nname: 坏卡\n', 'utf8')

    const list = listCharacters(p)
    expect(list.map((c) => c.id)).toEqual([good.id])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(join(charactersDir(p), 'broken.yaml'))
    )
  })
})

// ---------------------------------------------------------------------------
// update：裁定 1 三件套（新边 vs 旧边）
// ---------------------------------------------------------------------------

describe('updateCharacter 引用检查（裁定 1）', () => {
  it('(a) 新增指向存在角色/卷/世界观词条的边 → 保存成功并落盘', () => {
    const p = mkTmpBook()
    const a = createCharacter(p, seed('甲'))
    const b = createCharacter(p, seed('乙'))
    const vol = createVolume(p, '第一卷')
    const worldId = randomUUID()
    writeYamlFileAtomic(worldEntryFile(p, 'location', worldId), {
      id: worldId,
      title: '雾笼城',
      category: 'location',
      content: '',
      parentId: null,
      order: 1,
      tags: [],
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    const updated = updateCharacter(p, {
      ...b,
      relationships: [
        { targetId: a.id, kind: '结拜' },
        { targetId: vol.id, kind: '归属' },
        { targetId: worldId, kind: '守护' }
      ]
    })
    expect(updated.relationships).toHaveLength(3)
    expect(readYamlFile<CharacterV2>(characterFile(p, b.id)).relationships).toHaveLength(3)
  })

  it('(b) 新增指向不存在 id 的边 → REF_BROKEN: <targetId>，磁盘逐字节不动', () => {
    const p = mkTmpBook()
    const b = createCharacter(p, seed('乙'))
    const ghost = randomUUID()
    const rawBefore = readFileSync(characterFile(p, b.id), 'utf8')

    expect(() =>
      updateCharacter(p, { ...b, relationships: [{ targetId: ghost, kind: '仇敌' }] })
    ).toThrow(`REF_BROKEN: ${ghost}`)
    // links 数组同一规则
    expect(() => updateCharacter(p, { ...b, links: [{ targetId: ghost, kind: '提及' }] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    expect(readFileSync(characterFile(p, b.id), 'utf8')).toBe(rawBefore)
  })

  it('(c) 存量悬挂边 + 编辑 personality → 保存成功且悬挂边原样保留（删人不锁卡）', () => {
    const p = mkTmpBook()
    const ghost = randomUUID()
    const stored = plantWithDangling(p, '丙', ghost)

    const updated = updateCharacter(p, { ...stored, personality: '坚毅' })
    expect(updated.personality).toBe('坚毅')
    expect(updated.relationships).toEqual([{ targetId: ghost, kind: '恩人', note: '旧账' }])
    expect(readYamlFile<CharacterV2>(characterFile(p, stored.id)).relationships[0].targetId).toBe(
      ghost
    )

    // 悬挂边的 kind 改变（targetId 非新增）→ 同样放行
    const rekind = updateCharacter(p, {
      ...stored,
      relationships: [{ targetId: ghost, kind: '旧识' }]
    })
    expect(rekind.relationships).toEqual([{ targetId: ghost, kind: '旧识' }])

    // 删掉悬挂边永远允许
    const cleared = updateCharacter(p, { ...rekind, relationships: [] })
    expect(cleared.relationships).toEqual([])
  })

  it('arc[].chapterIds 同用新旧边规则：新增真实章 id 放行；新增幻影抛；存量幻影保留', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const c = createCharacter(p, seed('丁'))

    const ok = updateCharacter(p, {
      ...c,
      arc: [{ title: '觉醒', summary: '首章转折', chapterIds: [ch.id] }]
    })
    expect(ok.arc[0].chapterIds).toEqual([ch.id])

    const ghost = randomUUID()
    const rawBefore = readFileSync(characterFile(p, c.id), 'utf8')
    expect(() =>
      updateCharacter(p, { ...ok, arc: [{ title: '觉醒', summary: '', chapterIds: [ghost] }] })
    ).toThrow(`REF_BROKEN: ${ghost}`)
    expect(readFileSync(characterFile(p, c.id), 'utf8')).toBe(rawBefore)

    // 存量幻影 chapterId（章后来被删）+ 改其他字段 → 保留成功
    const dangling: CharacterV2 = {
      ...c,
      arc: [{ title: '沉沦', summary: '', chapterIds: [ghost] }]
    }
    writeYamlFileAtomic(characterFile(p, c.id), dangling)
    const saved = updateCharacter(p, { ...dangling, background: '旧伤' })
    expect(saved.arc[0].chapterIds).toEqual([ghost])
    expect(saved.background).toBe('旧伤')
  })
})

// ---------------------------------------------------------------------------
// update：守卫与时间戳
// ---------------------------------------------------------------------------

describe('updateCharacter 守卫', () => {
  it('BAD_CHARACTER_ID（形状）/ CHARACTER_MISSING（缺失）先于任何写盘', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('戊'))
    const ghost = randomUUID()
    const bad = { ...c, id: '../../evil', personality: 'x' } as CharacterV2
    expect(() => updateCharacter(p, bad)).toThrow('BAD_CHARACTER_ID: ../../evil')
    expect(() => updateCharacter(p, { ...c, id: ghost })).toThrow(`CHARACTER_MISSING: ${ghost}`)
    expect(existsSync(characterFile(p, ghost))).toBe(false)
  })

  it('名字仅在与存量不同时校验：含换行的存量名原样回显放行，改新的坏名抛 CHARACTER_NAME_INVALID: <id>', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('好名'))
    const legacyName = '旧\n换行名'
    writeYamlFileAtomic(characterFile(p, c.id), { ...c, name: legacyName })

    const stored = getCharacter(p, c.id) as CharacterV2
    expect(() => updateCharacter(p, { ...stored, name: '   ' })).toThrow(
      `CHARACTER_NAME_INVALID: ${c.id}`
    )
    expect(readYamlFile<CharacterV2>(characterFile(p, c.id)).personality).toBe('') // 抛错先于写盘

    const echoed = updateCharacter(p, { ...stored, name: legacyName, personality: '沉稳' })
    expect(echoed.name).toBe(legacyName) // 未改变 → 回显放行
  })

  it('写前 validateCharacterV2：坏形状（gender 非法）→ CHARACTER_INVALID 且磁盘不动', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('己'))
    const rawBefore = readFileSync(characterFile(p, c.id), 'utf8')
    expect(() =>
      updateCharacter(p, { ...c, gender: '未知' as CharacterV2['gender'] })
    ).toThrow(/CHARACTER_INVALID/)
    expect(readFileSync(characterFile(p, c.id), 'utf8')).toBe(rawBefore)
  })

  it('updatedAt 仓库侧刷新（渲染层回显垃圾值无所谓），createdAt 以存量为准', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('庚'))
    writeYamlFileAtomic(characterFile(p, c.id), {
      ...c,
      createdAt: '2001-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })

    const saved = updateCharacter(p, {
      ...c,
      personality: 'x',
      createdAt: '垃圾',
      updatedAt: '垃圾'
    } as CharacterV2)
    expect(saved.createdAt).toBe('2001-01-01T00:00:00.000Z')
    expect(saved.updatedAt).toMatch(ISO_RE)
    expect(saved.updatedAt > '2020-01-01T00:00:00.000Z').toBe(true)
    expect(readYamlFile<CharacterV2>(characterFile(p, c.id)).updatedAt).toBe(saved.updatedAt)
  })
})

// ---------------------------------------------------------------------------
// delete：幂等 + 不级联（裁定 1(c) 的前提）
// ---------------------------------------------------------------------------

describe('deleteCharacter', () => {
  it('删除成功 true；重复删/缺失/坏形状 id 一律 false 不抛（镜像 deleteChapter 契约分裂）', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('辛'))
    expect(deleteCharacter(p, c.id)).toBe(true)
    expect(existsSync(characterFile(p, c.id))).toBe(false)
    expect(deleteCharacter(p, c.id)).toBe(false)
    expect(deleteCharacter(p, randomUUID())).toBe(false)
    expect(deleteCharacter(p, '../evil')).toBe(false)
  })

  it('不级联：删除甲后，乙指向甲的边原样保留（列表仍读得出乙，降级显示属 UI 层）', () => {
    const p = mkTmpBook()
    const a = createCharacter(p, seed('甲'))
    const b = createCharacter(p, seed('乙'))
    updateCharacter(p, { ...b, relationships: [{ targetId: a.id, kind: '挚友' }] })

    expect(deleteCharacter(p, a.id)).toBe(true)
    const kept = listCharacters(p)
    expect(kept.map((c) => c.id)).toEqual([b.id])
    expect(kept[0].relationships).toEqual([{ targetId: a.id, kind: '挚友' }])
  })
})

// ---------------------------------------------------------------------------
// getCharacter 点读侧
// ---------------------------------------------------------------------------

describe('getCharacter', () => {
  it('缺失 → null；坏形状 id → BAD_CHARACTER_ID 抛；坏档点读把 CHARACTER_INVALID 抛穿（列表侧才容错）', () => {
    const p = mkTmpBook()
    const c = createCharacter(p, seed('壬'))
    expect(getCharacter(p, c.id)?.name).toBe('壬')
    expect(getCharacter(p, randomUUID())).toBeNull()
    expect(() => getCharacter(p, 'nope')).toThrow('BAD_CHARACTER_ID: nope')

    const brokenId = randomUUID()
    mkdirSync(charactersDir(p), { recursive: true })
    writeFileSync(
      join(charactersDir(p), `${brokenId}.yaml`),
      'id: 不是uuid\nname: 坏\n',
      'utf8'
    )
    expect(readdirSync(charactersDir(p))).toContain(`${brokenId}.yaml`)
    expect(() => getCharacter(p, brokenId)).toThrow(/CHARACTER_INVALID/)
  })
})

// v2 世界观词条仓库测试（Task 7）：tmp 书目录 + 真实文件系统，镜像 characters.test.ts（Task 6）的纪律——
// 三件套引用检查（parentId 只认「其他世界观词条」；links 认 角色 ∪ 卷 ∪ 词条；只拒本次新引入的幻影，
// 存量悬挂边原样放行）；守卫 BAD_WORLD_ID（delete 幂等 false）/ WORLD_MISSING /
// WORLD_TITLE_INVALID（仅 title 变化时校验）/ WORLD_INVALID（写前校验、点读抛穿、列表侧 warn+跳过）；
// 另钉 world 特有语义：分类目录搬迁（category 改 → 写新删旧、id 稳定）、跨类重复 id 按 updatedAt 新者去重、
// 列表只认枚举分类目录、listWorldEntryIds 宽容全目录扫（Task 6 直扫语义原样保留）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../tests/tmp'
import {
  createWorldEntry,
  deleteWorldEntry,
  getWorldEntry,
  listWorldEntries,
  listWorldEntryIds,
  updateWorldEntry
} from './world'
import { worldDir, worldEntryFile } from './paths'
import { readYamlFile, writeYamlFileAtomic } from './docStore'
import { createCharacter } from './characters'
import { createVolume } from './volumes'
import { UUID_PATTERN, validateWorldEntryV2 } from '../../../src/common/schema'
import type { WorldEntryV2 } from '../../../src/common/schema'
import type { SettingCategory } from '../../../src/common/ipc'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function seed(title: string, category: SettingCategory = 'location'): {
  title: string
  category: SettingCategory
} {
  return { title, category }
}

/** 手造「存量悬挂」词条：写盘绕开 create 的引用检查（模拟「目标后来被删」的既成事实）。 */
function plantWithDangling(p: string, title: string, ghost: string): WorldEntryV2 {
  const e = createWorldEntry(p, seed(title))
  const doc: WorldEntryV2 = {
    ...e,
    parentId: ghost,
    links: [{ targetId: ghost, kind: '旧账' }]
  }
  writeYamlFileAtomic(worldEntryFile(p, e.category, e.id), doc)
  return doc
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// create + list
// ---------------------------------------------------------------------------

describe('createWorldEntry + listWorldEntries', () => {
  it('create 落盘 world/<category>/<uuid>.yaml：默认空字段 + ISO 时间戳，中文标题过 validateWorldEntryV2', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, { title: '雾笼城', category: 'location', content: '终年被雾' })

    expect(e.id).toMatch(UUID_PATTERN)
    expect(e.title).toBe('雾笼城')
    expect(e.category).toBe('location')
    expect(e.content).toBe('终年被雾')
    expect(e.parentId).toBeNull()
    expect(e.order).toBe(0)
    expect(e.tags).toEqual([])
    expect(e.links).toEqual([])
    expect(e.createdAt).toMatch(ISO_RE)
    expect(e.updatedAt).toMatch(ISO_RE)
    // 文件名 = 全 id（纯 ASCII），中文只在内容字段里
    const abs = worldEntryFile(p, 'location', e.id)
    expect(existsSync(abs)).toBe(true)
    expect(readdirSync(join(worldDir(p), 'location'))).toEqual([`${e.id}.yaml`])
    expect(validateWorldEntryV2(readYamlFile<unknown>(abs))).toEqual([])
    expect(readYamlFile<WorldEntryV2>(abs)).toEqual(e)
    expect(listWorldEntries(p).map((x) => x.id)).toEqual([e.id])
  })

  it('create 第三参 init 覆盖（tags/order/parentId/links 一次原子写落盘）；init 携幻影引用同样被拒', () => {
    const p = mkTmpBook()
    const parent = createWorldEntry(p, seed('大陆'))
    const e = createWorldEntry(p, seed('山城'), {
      tags: ['重要'],
      order: 3,
      parentId: parent.id,
      links: [{ targetId: parent.id, kind: '位于' }]
    })
    expect(e.tags).toEqual(['重要'])
    expect(e.order).toBe(3)
    expect(e.parentId).toBe(parent.id)
    expect(readYamlFile<WorldEntryV2>(worldEntryFile(p, 'location', e.id)).parentId).toBe(parent.id)

    const ghost = randomUUID()
    expect(() => createWorldEntry(p, seed('坏子'), { parentId: ghost })).toThrow(`REF_BROKEN: ${ghost}`)
    expect(() => createWorldEntry(p, seed('坏链'), { links: [{ targetId: ghost, kind: '提及' }] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    expect(listWorldEntries(p).map((x) => x.id)).toEqual([parent.id, e.id])
  })

  it('create 空白/含换行标题 → WORLD_TITLE_INVALID（回显标题）且零落盘', () => {
    const p = mkTmpBook()
    expect(() => createWorldEntry(p, seed('  '))).toThrow('WORLD_TITLE_INVALID:   ')
    expect(() => createWorldEntry(p, seed('甲\r\n乙'))).toThrow('WORLD_TITLE_INVALID: 甲\r\n乙')
    expect(existsSync(worldDir(p))).toBe(false)
  })

  it('list 按 createdAt 升序（同刻按 stem）；stem 与 doc.id 不一致时以文件名为准', () => {
    const p = mkTmpBook()
    const newId = randomUUID()
    const oldId = randomUUID()
    const base = createWorldEntry(p, seed('基'))
    const mk = (id: string, createdAt: string): WorldEntryV2 => ({
      ...base,
      id,
      title: id.slice(0, 4),
      createdAt,
      updatedAt: createdAt
    })
    writeYamlFileAtomic(worldEntryFile(p, 'other', newId), mk('ffffffff-0000-4000-8000-000000000000', '2020-01-01T00:00:00.000Z'))
    writeYamlFileAtomic(worldEntryFile(p, 'other', oldId), mk('eeeeeeee-0000-4000-8000-000000000000', '2010-01-01T00:00:00.000Z'))

    expect(listWorldEntries(p).map((e) => e.id)).toEqual([oldId, newId, base.id]) // 2010 < 2020 < 基(2026)
  })

  it('坏词条档 console.warn（绝对路径）+ 跳过，绝不整体抛；非枚举分类目录整体忽略', () => {
    const p = mkTmpBook()
    const good = createWorldEntry(p, seed('完好'))
    mkdirSync(join(worldDir(p), 'location'), { recursive: true })
    writeFileSync(join(worldDir(p), 'location', 'broken.yaml'), 'id: 不是uuid\n', 'utf8')
    const strayId = randomUUID()
    mkdirSync(join(worldDir(p), 'not-a-category'), { recursive: true })
    writeYamlFileAtomic(join(worldDir(p), 'not-a-category', `${strayId}.yaml`), {
      ...good,
      id: strayId,
      title: '流浪词条'
    })

    const list = listWorldEntries(p)
    expect(list.map((e) => e.id)).toEqual([good.id]) // 损坏档与未知目录都不遮蔽正常档
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(join(worldDir(p), 'location', 'broken.yaml'))
    )
  })

  it('跨类重复 id（搬迁后旧文件删除失败的残留）：list/get 只保留 updatedAt 较新的一份', () => {
    const p = mkTmpBook()
    const dupId = randomUUID()
    const stale: WorldEntryV2 = {
      id: dupId,
      title: '旧位置',
      category: 'magic',
      content: 'stale',
      parentId: null,
      order: 0,
      tags: [],
      links: [],
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    }
    writeYamlFileAtomic(worldEntryFile(p, 'location', dupId), stale) // 旧目录里的残留副本
    writeYamlFileAtomic(worldEntryFile(p, 'magic', dupId), {
      ...stale,
      title: '新位置',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    const list = listWorldEntries(p)
    expect(list.map((e) => e.id)).toEqual([dupId]) // 去重，只出一条
    expect(list[0].title).toBe('新位置')
    expect((getWorldEntry(p, dupId) as WorldEntryV2).title).toBe('新位置')
  })
})

// ---------------------------------------------------------------------------
// update：分类搬迁 + 裁定 1（新引用 vs 旧引用）
// ---------------------------------------------------------------------------

describe('updateWorldEntry 分类搬迁', () => {
  it('category 改变 = 先写新路径再删旧路径：id 稳定、旧文件消失、内容随迁', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('雾笼城', 'location'), { content: '终年被雾' })

    const moved = updateWorldEntry(p, { ...e, category: 'history' })
    expect(moved.id).toBe(e.id)
    expect(moved.category).toBe('history')
    expect(existsSync(worldEntryFile(p, 'history', e.id))).toBe(true)
    expect(existsSync(worldEntryFile(p, 'location', e.id))).toBe(false)
    expect(readYamlFile<WorldEntryV2>(worldEntryFile(p, 'history', e.id)).content).toBe('终年被雾')
    expect(listWorldEntries(p).map((x) => x.id)).toEqual([e.id])
  })

  it('中文标题改名不动文件名：同一 <id>.yaml，仅内容字段更新', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('旧名'))
    const abs = worldEntryFile(p, 'location', e.id)

    const renamed = updateWorldEntry(p, { ...e, title: '新中文名' })
    expect(renamed.title).toBe('新中文名')
    expect(readdirSync(join(worldDir(p), 'location'))).toEqual([`${e.id}.yaml`])
    expect(readYamlFile<WorldEntryV2>(abs).title).toBe('新中文名')
  })
})

describe('updateWorldEntry 引用检查（裁定 1：只拒新引入的幻影）', () => {
  it('parentId 新指向其他词条 / links 新指向角色·卷·词条 → 保存成功并落盘', () => {
    const p = mkTmpBook()
    const parent = createWorldEntry(p, seed('大陆'))
    const ch = createCharacter(p, { name: '阿明', gender: 'male', role: 'protagonist' })
    const vol = createVolume(p, '第一卷')
    const e = createWorldEntry(p, seed('雾笼城'))

    const updated = updateWorldEntry(p, {
      ...e,
      parentId: parent.id,
      links: [
        { targetId: ch.id, kind: '居于此' },
        { targetId: vol.id, kind: '首见' },
        { targetId: parent.id, kind: '隶属' }
      ]
    })
    expect(updated.parentId).toBe(parent.id)
    expect(updated.links).toHaveLength(3)
    expect(readYamlFile<WorldEntryV2>(worldEntryFile(p, 'location', e.id)).links).toHaveLength(3)
  })

  it('新增幻影 parentId / links targetId → REF_BROKEN: <targetId>，磁盘逐字节不动', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('雾笼城'))
    const ghost = randomUUID()
    const rawBefore = readFileSync(worldEntryFile(p, 'location', e.id), 'utf8')

    expect(() => updateWorldEntry(p, { ...e, parentId: ghost })).toThrow(`REF_BROKEN: ${ghost}`)
    expect(() => updateWorldEntry(p, { ...e, links: [{ targetId: ghost, kind: '提及' }] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    // parentId 只认词条：指向存在的角色/卷也照样 REF_BROKEN（世界层级不外扩）
    const ch = createCharacter(p, { name: '阿明', gender: 'male', role: 'protagonist' })
    expect(() => updateWorldEntry(p, { ...e, parentId: ch.id })).toThrow(`REF_BROKEN: ${ch.id}`)
    expect(readFileSync(worldEntryFile(p, 'location', e.id), 'utf8')).toBe(rawBefore)
  })

  it('存量悬挂 parentId/link（目标后来被删）+ 编辑 content → 保存成功且悬挂引用原样保留', () => {
    const p = mkTmpBook()
    const ghost = randomUUID()
    const stored = plantWithDangling(p, '丙', ghost)

    const saved = updateWorldEntry(p, { ...stored, content: '新描述' })
    expect(saved.content).toBe('新描述')
    expect(saved.parentId).toBe(ghost)
    expect(saved.links).toEqual([{ targetId: ghost, kind: '旧账' }])

    // 悬挂边的 kind 改变（targetId 非新增）→ 同样放行；删边永远允许
    const rekind = updateWorldEntry(p, { ...saved, links: [{ targetId: ghost, kind: '旧识' }] })
    expect(rekind.links).toEqual([{ targetId: ghost, kind: '旧识' }])
    expect(updateWorldEntry(p, { ...rekind, parentId: null, links: [] }).links).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// update：守卫与时间戳
// ---------------------------------------------------------------------------

describe('updateWorldEntry 守卫', () => {
  it('BAD_WORLD_ID（形状）/ WORLD_MISSING（缺失）先于任何写盘', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('戊'))
    const ghost = randomUUID()
    const bad = { ...e, id: '../../evil', content: 'x' } as WorldEntryV2
    expect(() => updateWorldEntry(p, bad)).toThrow('BAD_WORLD_ID: ../../evil')
    expect(() => updateWorldEntry(p, { ...e, id: ghost })).toThrow(`WORLD_MISSING: ${ghost}`)
    expect(existsSync(worldEntryFile(p, 'location', ghost))).toBe(false)
  })

  it('title 仅在与存量不同时校验：存量坏形状原样回显放行，改新的坏标题抛 WORLD_TITLE_INVALID: <id>', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('好名'))
    const legacyTitle = '旧\n换行名'
    writeYamlFileAtomic(worldEntryFile(p, 'location', e.id), { ...e, title: legacyTitle })

    const stored = getWorldEntry(p, e.id) as WorldEntryV2
    expect(() => updateWorldEntry(p, { ...stored, title: '   ' })).toThrow(
      `WORLD_TITLE_INVALID: ${e.id}`
    )
    expect(readYamlFile<WorldEntryV2>(worldEntryFile(p, 'location', e.id)).content).toBe('') // 抛错先于写盘

    const echoed = updateWorldEntry(p, { ...stored, title: legacyTitle, content: '沉稳' })
    expect(echoed.title).toBe(legacyTitle) // 未改变 → 回显放行
  })

  it('写前 validateWorldEntryV2：坏形状（category 非法）→ WORLD_INVALID 且磁盘不动', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('己'))
    const rawBefore = readFileSync(worldEntryFile(p, 'location', e.id), 'utf8')
    expect(() =>
      updateWorldEntry(p, { ...e, category: '未知' as WorldEntryV2['category'] })
    ).toThrow(/WORLD_INVALID/)
    expect(readFileSync(worldEntryFile(p, 'location', e.id), 'utf8')).toBe(rawBefore)
  })

  it('updatedAt 仓库侧刷新（渲染层回显垃圾值无所谓），createdAt 以存量为准', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('庚'))
    writeYamlFileAtomic(worldEntryFile(p, 'location', e.id), {
      ...e,
      createdAt: '2001-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })

    const saved = updateWorldEntry(p, {
      ...e,
      content: 'x',
      createdAt: '垃圾',
      updatedAt: '垃圾'
    } as WorldEntryV2)
    expect(saved.createdAt).toBe('2001-01-01T00:00:00.000Z')
    expect(saved.updatedAt).toMatch(ISO_RE)
    expect(saved.updatedAt > '2020-01-01T00:00:00.000Z').toBe(true)
    expect(readYamlFile<WorldEntryV2>(worldEntryFile(p, 'location', e.id)).updatedAt).toBe(
      saved.updatedAt
    )
  })
})

// ---------------------------------------------------------------------------
// delete：幂等 + 不级联
// ---------------------------------------------------------------------------

describe('deleteWorldEntry', () => {
  it('删除成功 true；重复删/缺失/坏形状 id 一律 false 不抛（镜像 deleteChapter 契约分裂）', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('辛'))
    expect(deleteWorldEntry(p, e.id)).toBe(true)
    expect(existsSync(worldEntryFile(p, 'location', e.id))).toBe(false)
    expect(deleteWorldEntry(p, e.id)).toBe(false)
    expect(deleteWorldEntry(p, randomUUID())).toBe(false)
    expect(deleteWorldEntry(p, '../evil')).toBe(false)
  })

  it('不级联：删除父词条后，子词条的悬挂 parentId 原样保留且仍可读', () => {
    const p = mkTmpBook()
    const parent = createWorldEntry(p, seed('大陆'))
    const child = createWorldEntry(p, seed('山城'), { parentId: parent.id })

    expect(deleteWorldEntry(p, parent.id)).toBe(true)
    const kept = listWorldEntries(p)
    expect(kept.map((e) => e.id)).toEqual([child.id])
    expect(kept[0].parentId).toBe(parent.id)
  })
})

// ---------------------------------------------------------------------------
// getWorldEntry 点读侧
// ---------------------------------------------------------------------------

describe('getWorldEntry', () => {
  it('缺失 → null；坏形状 id → BAD_WORLD_ID 抛；坏档点读把 WORLD_INVALID 抛穿（列表侧才容错）', () => {
    const p = mkTmpBook()
    const e = createWorldEntry(p, seed('壬'))
    expect(getWorldEntry(p, e.id)?.title).toBe('壬')
    expect(getWorldEntry(p, randomUUID())).toBeNull()
    expect(() => getWorldEntry(p, 'nope')).toThrow('BAD_WORLD_ID: nope')

    const brokenId = randomUUID()
    mkdirSync(join(worldDir(p), 'history'), { recursive: true })
    writeFileSync(join(worldDir(p), 'history', `${brokenId}.yaml`), 'id: 不是uuid\n', 'utf8')
    expect(() => getWorldEntry(p, brokenId)).toThrow(/WORLD_INVALID/)
  })
})

// ---------------------------------------------------------------------------
// listWorldEntryIds（characters.ts Task 6 临时直扫的单一定源替换）
// ---------------------------------------------------------------------------

describe('listWorldEntryIds', () => {
  it('只认存在性：全目录宽容扫（含非枚举目录的 stem），不校验内容、不抛', () => {
    const p = mkTmpBook()
    const good = createWorldEntry(p, seed('完好'))
    const strayId = randomUUID()
    mkdirSync(join(worldDir(p), 'not-a-category'), { recursive: true })
    writeFileSync(join(worldDir(p), 'not-a-category', `${strayId}.yaml`), 'id: 不是uuid\n', 'utf8')

    expect(listWorldEntryIds(p).sort()).toEqual([good.id, strayId].sort())
    // 词条目录整体缺失 → 空数组（world/ 尚不存在的新书）
    expect(listWorldEntryIds(mkTmpBook())).toEqual([])
  })
})

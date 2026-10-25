// v2 卷仓库测试（Task 5）：tmp 书目录 + 真实文件系统，钉死 brief Step 1 全部行为——
// create→list 有序（order 稠密 1..n）；rename 只改 title；moveChapterToVolume 只动 front-matter
// 的 volumeId（order 与 body 字节不动）；deleteVolume 无孤儿（其下章节 volumeId→null 且章文件仍在，
// review-focus-5 场景）；坏卷档 list 侧 console.warn + 跳过（与章节列表同一容错分工）。
// 控制器裁定的守卫镜像章节：BAD_VOLUME_ID / VOLUME_MISSING / VOLUME_TITLE_INVALID（仅 title 变化时校验）/
// delete 幂等返回 false。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import {
  createVolume,
  deleteVolume,
  listVolumes,
  moveChapterToVolume,
  renameVolume,
  reorderVolumes
} from './volumes'
import { chapterFile, volumeFile, volumesDir } from './paths'
import { createChapter, getChapter, listChapters, updateChapter } from './chapters'
import { readYamlFile, writeYamlFileAtomic } from './docStore'
import { parseChapterDoc } from '../../../src/common/chapterDoc'
import { UUID_PATTERN } from '../../../src/common/schema'

// 模拟「某章点写失败」（FRONTMATTER_* 抛穿的等价物）：按 id 开关抛错，其余委托真实实现。
// 用于证明 deleteVolume 的无孤儿保证——任何一章更新失败即整体中止，卷文件绝不先行删除。
const failing = vi.hoisted(() => ({ id: '', enabled: false }))
vi.mock('./chapters', async (importActual) => {
  const actual = await importActual<typeof import('./chapters')>()
  return {
    ...actual,
    updateChapter: (
      p: string,
      id: string,
      patch: Parameters<typeof actual.updateChapter>[2]
    ) => {
      if (failing.enabled && id === failing.id) {
        throw new Error('FRONTMATTER_INVALID: 模拟损坏章（update 抛穿）')
      }
      return actual.updateChapter(p, id, patch)
    }
  }
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  failing.enabled = false
  failing.id = ''
})

// ---------------------------------------------------------------------------
// create + list
// ---------------------------------------------------------------------------

describe('createVolume + listVolumes', () => {
  it('create 落盘 volumes/<uuid>.yaml；list 按 order 升序且稠密 1..n', () => {
    const p = mkTmpBook()
    const a = createVolume(p, '第一卷')
    const b = createVolume(p, '第二卷')

    expect(a.id).toMatch(UUID_PATTERN)
    expect(existsSync(volumeFile(p, a.id))).toBe(true)
    expect(readYamlFile<{ id: string; title: string; order: number }>(volumeFile(p, a.id))).toEqual({
      id: a.id,
      title: '第一卷',
      order: 1
    })
    expect(b.order).toBe(2)

    const list = listVolumes(p)
    expect(list.map((v) => v.title)).toEqual(['第一卷', '第二卷'])
    expect(list.map((v) => v.order)).toEqual([1, 2])
    expect(list.map((v) => v.id)).toEqual([a.id, b.id])
  })

  it('volumes 目录不存在 → listVolumes 返回空数组', () => {
    const p = mkTmpBook()
    expect(listVolumes(p)).toEqual([])
  })

  it('create 空白/含换行标题 → VOLUME_TITLE_INVALID（回显 title）且零落盘', () => {
    const p = mkTmpBook()
    expect(() => createVolume(p, '  ')).toThrow('VOLUME_TITLE_INVALID:   ')
    expect(() => createVolume(p, '甲\r\n乙')).toThrow('VOLUME_TITLE_INVALID: 甲\r\n乙')
    expect(existsSync(volumesDir(p))).toBe(false)
  })

  it('坏卷档（非法 YAML/校验不过）list 时 console.warn + 跳过，绝不整体抛', () => {
    const p = mkTmpBook()
    const good = createVolume(p, '完好卷')
    mkdirSync(volumesDir(p), { recursive: true })
    writeFileSync(join(volumesDir(p), 'broken.yaml'), 'id: 不是uuid\ntitle: 坏卷\norder: 1\n', 'utf8')

    const list = listVolumes(p)
    expect(list.map((v) => v.id)).toEqual([good.id])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(join(volumesDir(p), 'broken.yaml'))
    )
  })
})

// ---------------------------------------------------------------------------
// rename + 守卫
// ---------------------------------------------------------------------------

describe('renameVolume', () => {
  it('rename 只改 title，id/order 不动', () => {
    const p = mkTmpBook()
    const v = createVolume(p, '旧卷名')
    const renamed = renameVolume(p, v.id, '新卷名')
    expect(renamed.title).toBe('新卷名')
    expect(renamed.order).toBe(v.order)
    expect(renamed.id).toBe(v.id)
    expect(readYamlFile<{ title: string }>(volumeFile(p, v.id)).title).toBe('新卷名')
  })

  it('守卫镜像章节：BAD_VOLUME_ID（形状）/ VOLUME_MISSING（缺失）/ VOLUME_TITLE_INVALID（变化才校验）', () => {
    const p = mkTmpBook()
    const v = createVolume(p, '卷')
    const ghost = '99999999-8888-4888-8888-777777777777'

    expect(() => renameVolume(p, '../../evil', 'x')).toThrow('BAD_VOLUME_ID: ../../evil')
    expect(() => renameVolume(p, ghost, 'x')).toThrow(`VOLUME_MISSING: ${ghost}`)
    expect(() => renameVolume(p, v.id, '  ')).toThrow(`VOLUME_TITLE_INVALID: ${v.id}`)
    // 抛错先于任何写盘：卷档原样
    expect(readYamlFile<{ title: string }>(volumeFile(p, v.id)).title).toBe('卷')
  })

  it('存量坏形状 title 原样回显（未改变）→ 放行，不静默改写', () => {
    const p = mkTmpBook()
    const v = createVolume(p, '好卷')
    // 手造存量坏档：title 含换行（validateVolumeDoc 只要求非空串，yaml 引号机制可承载）
    const badTitle = '旧\n换行题'
    writeYamlFileAtomic(volumeFile(p, v.id), { id: v.id, title: badTitle, order: 1 })
    expect(() => renameVolume(p, v.id, '新值\n换行')).toThrow(`VOLUME_TITLE_INVALID: ${v.id}`)
    const renamed = renameVolume(p, v.id, badTitle) // 未改变 → 回显放行
    expect(renamed.title).toBe(badTitle)
  })
})

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

describe('reorderVolumes', () => {
  it('把丙移到乙所在槽位：order 重编稠密 1..n，正文无关的卷档只重写变化者', () => {
    const p = mkTmpBook()
    const a = createVolume(p, '甲卷')
    const b = createVolume(p, '乙卷')
    const c = createVolume(p, '丙卷')

    expect(reorderVolumes(p, c.id, b.id)).toBe(true)
    const list = listVolumes(p)
    expect(list.map((v) => v.id)).toEqual([a.id, c.id, b.id])
    expect(list.map((v) => v.title)).toEqual(['甲卷', '丙卷', '乙卷'])
    expect(list.map((v) => v.order)).toEqual([1, 2, 3])
  })

  it('toId 不存在 → false 且列表不动；fromId 形状坏 → BAD_VOLUME_ID 抛', () => {
    const p = mkTmpBook()
    const a = createVolume(p, '甲卷')
    createVolume(p, '乙卷')
    const ghost = '99999999-8888-4888-8888-777777777777'
    expect(reorderVolumes(p, a.id, ghost)).toBe(false)
    expect(listVolumes(p).map((v) => v.title)).toEqual(['甲卷', '乙卷'])
    expect(() => reorderVolumes(p, 'nope', a.id)).toThrow('BAD_VOLUME_ID: nope')
  })
})

// ---------------------------------------------------------------------------
// moveChapterToVolume
// ---------------------------------------------------------------------------

describe('moveChapterToVolume', () => {
  it('移入卷：只动 front-matter 的 volumeId，body 字节与 order 不动', () => {
    const p = mkTmpBook()
    const vol = createVolume(p, '目标卷')
    const ch = createChapter(p, '章一')
    updateChapter(p, ch.id, { content: '# 章一\r\n\r\n带 CRLF 的正文。\r\n' })
    const rawBefore = readFileSync(chapterFile(p, ch.id), 'utf8')
    const bodyBefore = parseChapterDoc(rawBefore, ch.id).body
    const orderBefore = parseChapterDoc(rawBefore, ch.id).meta.order

    const moved = moveChapterToVolume(p, ch.id, vol.id)
    expect(moved.volumeId).toBe(vol.id)
    expect(moved.order).toBe(orderBefore)

    const rawAfter = readFileSync(chapterFile(p, ch.id), 'utf8')
    expect(rawAfter.endsWith(bodyBefore)).toBe(true) // body 逐字节原样（meta-only patch）
    expect(parseChapterDoc(rawAfter, ch.id).meta.order).toBe(orderBefore)
  })

  it('volumeId=null → 回未分卷；缺省/不存在/坏形状的卷 id 各有明确语义', () => {
    const p = mkTmpBook()
    const vol = createVolume(p, '卷')
    const ch = createChapter(p, '章', vol.id)

    expect(moveChapterToVolume(p, ch.id, null).volumeId).toBeNull()

    // 章放回不存在的卷 = 隐身章，被仓库边界拒绝（抛在 updateChapter 之前，章文件不动）
    const ghost = '99999999-8888-4888-8888-777777777777'
    expect(() => moveChapterToVolume(p, ch.id, ghost)).toThrow(`VOLUME_MISSING: ${ghost}`)
    expect(getChapter(p, ch.id)!.volumeId).toBeNull()
    expect(() => moveChapterToVolume(p, ch.id, 'evil')).toThrow('BAD_VOLUME_ID: evil')

    // 章不存在 → CHAPTER_MISSING（委托 updateChapter 的守卫）
    expect(() => moveChapterToVolume(p, ghost, vol.id)).toThrow(`CHAPTER_MISSING: ${ghost}`)
  })
})

// ---------------------------------------------------------------------------
// deleteVolume —— review-focus-5：无孤儿
// ---------------------------------------------------------------------------

describe('deleteVolume', () => {
  it('建卷A/B→3章入A→删A：其下 3 章 volumeId=null 且章文件仍在，回到未分卷', () => {
    const p = mkTmpBook()
    const a = createVolume(p, 'A卷')
    const b = createVolume(p, 'B卷')
    const c1 = createChapter(p, '一', a.id)
    const c2 = createChapter(p, '二', a.id)
    const c3 = createChapter(p, '三', b.id)

    expect(deleteVolume(p, a.id)).toBe(true)
    expect(existsSync(volumeFile(p, a.id))).toBe(false)
    expect(existsSync(volumeFile(p, b.id))).toBe(true)

    const list = listChapters(p)
    expect(list.find((c) => c.id === c1.id)!.volumeId).toBeNull()
    expect(list.find((c) => c.id === c2.id)!.volumeId).toBeNull()
    expect(list.find((c) => c.id === c3.id)!.volumeId).toBe(b.id)
    // 章文件仍在且正文不动
    for (const c of [c1, c2, c3]) {
      expect(existsSync(chapterFile(p, c.id))).toBe(true)
    }
    expect(listVolumes(p).map((v) => v.id)).toEqual([b.id])
  })

  it('幂等：重复删 false；坏形状 id false 不抛（镜像 deleteChapter 契约）', () => {
    const p = mkTmpBook()
    const a = createVolume(p, '卷')
    expect(deleteVolume(p, a.id)).toBe(true)
    expect(deleteVolume(p, a.id)).toBe(false)
    expect(deleteVolume(p, '../../evil')).toBe(false)
  })

  it('任一章更新抛错 → 整体中止：卷文件保留，绝无「卷没了但章还指向它」的孤儿', () => {
    const p = mkTmpBook()
    const a = createVolume(p, 'A卷')
    const c1 = createChapter(p, '一', a.id) // order 1，先迁走
    const c2 = createChapter(p, '二', a.id) // order 2，模拟写失败 → 中止

    failing.enabled = true
    failing.id = c2.id
    expect(() => deleteVolume(p, a.id)).toThrow('FRONTMATTER_INVALID')
    failing.enabled = false

    // 卷文件原样保留；任何一章都不指向已删除的卷（要么 null 要么卷仍在）
    expect(existsSync(volumeFile(p, a.id))).toBe(true)
    expect(getChapter(p, c1.id)!.volumeId).toBeNull()
    expect(getChapter(p, c2.id)!.volumeId).toBe(a.id)
  })
})

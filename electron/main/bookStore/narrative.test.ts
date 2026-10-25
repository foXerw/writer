// 叙事三域仓库测试（Task 8）：plotlines/<uuid>.yaml = PlotlineV2、choices/<uuid>.yaml = ChoiceNodeV2、
// foreshadow.yaml = 单文件台账 {entries: ForeshadowEntry[]}（整读整写原子 RMW）。
// 守卫纪律逐条镜像 characters/volumes：BAD_*_ID 门（delete 幂等 false 不抛）/ *_MISSING /
// *_TITLE_INVALID（仅变化时校验）/ *_INVALID（写前校验、点侧抛穿、列表侧 warn+跳过）/
// updatedAt 仓库侧刷新、createdAt 以存量为准 / 引用检查「新边 vs 旧边」（Task 6 裁定 1 原样）：
// plotline stages[].chapterIds ⊆ refs.chapterIds、stages[].entityIds ⊆ refs.allEntityIds（数组多值，
// 只拒本次新引入的幻影）；choice.chapterId 单值字段镜像 world.parentId——改到幻影才拒、存量悬挂放行；
// 伏笔状态机：open→resolved(resolve，携存在章 id)|abandoned(abandon)、resolved→open、
// abandoned→open（reopen）——其余转移一律 FORESHADOW_TRANSITION；upsert 从不改机对状态
// （status + resolvedChapterId 只认转移函数，机对新写入者按校验后的形状接受，Task 8 裁定）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../tests/tmp'
import {
  abandonForeshadow,
  createChoice,
  createPlotline,
  deleteChoice,
  deletePlotline,
  listChoices,
  listPlotlines,
  readLedger,
  reopenForeshadow,
  resolveForeshadow,
  updateChoice,
  updatePlotline,
  upsertForeshadow,
  writeLedger
} from './narrative'
import { allEntityIds, chapterIds } from './refs'
import { choicesDir, foreshadowFile, plotlineFile, plotlinesDir, worldDir } from './paths'
import { readYamlFile, writeYamlFileAtomic } from './docStore'
import { createChapter, deleteChapter } from './chapters'
import { createCharacter } from './characters'
import { createVolume } from './volumes'
import type {
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineStage,
  PlotlineV2
} from '../../../src/common/schema'
import {
  UUID_PATTERN,
  validateChoiceNodeV2,
  validateForeshadowEntry,
  validatePlotlineV2
} from '../../../src/common/schema'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function stage(chapterIdsIn: string[], entityIdsIn: string[]): PlotlineStage {
  return { title: '阶段一', summary: '', chapterIds: chapterIdsIn, entityIds: entityIdsIn }
}

function choiceAbs(p: string, id: string): string {
  return join(choicesDir(p), `${id}.yaml`)
}

/** 手造「存量悬挂引用」剧情线：写盘绕开 create 的引用检查（模拟「对方后来被删」的既成事实）。 */
function plantPlotlineWithDangling(p: string, chapterId: string, entityId: string): PlotlineV2 {
  const doc = createPlotline(p, { title: '旧线' })
  const planted: PlotlineV2 = { ...doc, stages: [stage([chapterId], [entityId])] }
  writeYamlFileAtomic(plotlineFile(p, doc.id), planted)
  return planted
}

function mkEntry(over?: Partial<ForeshadowEntry>): ForeshadowEntry {
  return {
    id: randomUUID(),
    title: '旧钟',
    plantedChapterId: randomUUID(), // 台账对章引用不做存在性检查（Task 8 裁定），形状合法即可
    plannedPayoffNote: '',
    resolvedChapterId: null,
    status: 'open',
    ...over
  }
}

/** 经 upsert 种一条 open 伏笔并返回它。 */
function plantEntry(p: string): ForeshadowEntry {
  const e = mkEntry()
  upsertForeshadow(p, e)
  return e
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// plotline：create + list
// ---------------------------------------------------------------------------

describe('createPlotline + listPlotlines', () => {
  it('create 落盘 plotlines/<uuid>.yaml：默认空字段 + ISO 时间戳，过 validatePlotlineV2 且读回全等', () => {
    const p = mkTmpBook()
    const pl = createPlotline(p, { title: '主线' })
    expect(pl.id).toMatch(UUID_PATTERN)
    expect(pl.title).toBe('主线')
    expect(pl.summary).toBe('')
    expect(pl.status).toBe('active')
    expect(pl.stages).toEqual([])
    expect(pl.createdAt).toMatch(ISO_RE)
    const stored = readYamlFile<unknown>(plotlineFile(p, pl.id))
    expect(validatePlotlineV2(stored)).toEqual([])
    expect(stored).toEqual(pl)
  })

  it('create init 覆盖：stages 引用真实章/角色/卷一次落盘；init 携 id/createdAt 一律无效', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const car = createCharacter(p, { name: '阿明', gender: 'male', role: 'protagonist' })
    const vol = createVolume(p, '第一卷')
    const pl = createPlotline(
      p,
      { title: '复仇线', summary: '起于灭门' },
      { id: '../../evil', createdAt: '垃圾', stages: [stage([ch.id], [car.id, vol.id])] }
    )
    expect(pl.id).toMatch(UUID_PATTERN)
    expect(pl.createdAt).toMatch(ISO_RE)
    expect(pl.summary).toBe('起于灭门')
    expect(pl.stages).toEqual([stage([ch.id], [car.id, vol.id])])
  })

  it('create 实体集宽容：stages.entityIds 指向非枚举世界观目录的散档 → 放行（refs.worldIds 不收紧）', () => {
    const p = mkTmpBook()
    const strayId = randomUUID()
    mkdirSync(join(worldDir(p), 'not-a-category'), { recursive: true })
    writeFileSync(join(worldDir(p), 'not-a-category', `${strayId}.yaml`), 'id: 不是uuid\n', 'utf8')
    expect(allEntityIds(p)).toContain(strayId)

    const pl = createPlotline(p, { title: '散线' }, { stages: [stage([], [strayId])] })
    expect(pl.stages[0].entityIds).toEqual([strayId])
  })

  it('create 空白/含换行标题 → PLOTLINE_TITLE_INVALID（回显标题）且零落盘', () => {
    const p = mkTmpBook()
    expect(() => createPlotline(p, { title: '  ' })).toThrow('PLOTLINE_TITLE_INVALID:   ')
    expect(() => createPlotline(p, { title: '甲\r\n乙' })).toThrow('PLOTLINE_TITLE_INVALID: 甲\r\n乙')
    expect(existsSync(plotlinesDir(p))).toBe(false)
  })

  it('create 幻影 stage chapterId/entityId → REF_BROKEN 且零落盘', () => {
    const p = mkTmpBook()
    const ghost = randomUUID()
    expect(() => createPlotline(p, { title: '甲' }, { stages: [stage([ghost], [])] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    expect(() => createPlotline(p, { title: '乙' }, { stages: [stage([], [ghost])] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    expect(existsSync(plotlinesDir(p))).toBe(false)
  })

  it('list 按 createdAt 升序（同刻按 id）；stem 与 doc.id 不一致时以文件名为准', () => {
    const p = mkTmpBook()
    const base = createPlotline(p, { title: '基' })
    const mk = (id: string, createdAt: string): PlotlineV2 => ({
      ...base,
      id,
      title: id.slice(0, 4),
      createdAt,
      updatedAt: createdAt
    })
    const newId = randomUUID()
    const oldId = randomUUID()
    writeYamlFileAtomic(plotlineFile(p, newId), mk('ffffffff-0000-4000-8000-000000000000', '2020-01-01T00:00:00.000Z'))
    writeYamlFileAtomic(plotlineFile(p, oldId), mk('eeeeeeee-0000-4000-8000-000000000000', '2010-01-01T00:00:00.000Z'))
    expect(listPlotlines(p).map((x) => x.id)).toEqual([oldId, newId, base.id])
  })

  it('坏档 list 时 console.warn + 跳过，绝不整体抛', () => {
    const p = mkTmpBook()
    const good = createPlotline(p, { title: '完好' })
    mkdirSync(plotlinesDir(p), { recursive: true })
    writeFileSync(join(plotlinesDir(p), 'broken.yaml'), 'id: 不是uuid\n', 'utf8')
    expect(listPlotlines(p).map((x) => x.id)).toEqual([good.id])
    expect(console.warn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// plotline：update / delete + 引用「新边 vs 旧边」
// ---------------------------------------------------------------------------

describe('updatePlotline + deletePlotline', () => {
  it('update 整档写入：updatedAt 仓库侧刷新、createdAt 以存量为准', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const pl = createPlotline(p, { title: '旧题' })
    const next = updatePlotline(p, {
      ...pl,
      title: '新题',
      createdAt: '垃圾',
      stages: [stage([ch.id], [])]
    })
    expect(next.title).toBe('新题')
    expect(next.createdAt).toBe(pl.createdAt)
    expect(next.updatedAt).toMatch(ISO_RE)
    expect(readYamlFile<PlotlineV2>(plotlineFile(p, pl.id)).stages).toHaveLength(1)
  })

  it('update 守卫：坏形状 id → BAD_PLOTLINE_ID；缺失 → PLOTLINE_MISSING；存量坏标题回显放行', () => {
    const p = mkTmpBook()
    const pl = createPlotline(p, { title: '甲' })
    expect(() => updatePlotline(p, { ...pl, id: '../../evil' })).toThrow('BAD_PLOTLINE_ID: ../../evil')
    expect(() => updatePlotline(p, { ...pl, id: randomUUID() })).toThrow(/PLOTLINE_MISSING: /)
    // 手造存量多行标题（schema 合法——仓库门只拦「改变」的标题）：改 summary 成功
    const doc: PlotlineV2 = { ...pl, title: '坏\r\n题' }
    writeYamlFileAtomic(plotlineFile(p, pl.id), doc)
    expect(updatePlotline(p, { ...doc, summary: '补记' }).title).toBe('坏\r\n题')
    expect(() => updatePlotline(p, { ...doc, title: '  ' })).toThrow(`PLOTLINE_TITLE_INVALID: ${pl.id}`)
  })

  it('(b) 新增幻影 stage 引用 → REF_BROKEN: <id>，磁盘逐字节不动', () => {
    const p = mkTmpBook()
    const pl = createPlotline(p, { title: '甲' })
    const rawBefore = readFileSync(plotlineFile(p, pl.id), 'utf8')
    const ghost = randomUUID()
    expect(() => updatePlotline(p, { ...pl, stages: [stage([], [ghost])] })).toThrow(
      `REF_BROKEN: ${ghost}`
    )
    expect(readFileSync(plotlineFile(p, pl.id), 'utf8')).toBe(rawBefore)
  })

  it('(c) 存量悬挂 stage 引用 + 编辑其他字段 → 成功且悬挂原样保留', () => {
    const p = mkTmpBook()
    const planted = plantPlotlineWithDangling(p, randomUUID(), randomUUID())
    const next = updatePlotline(p, { ...planted, summary: '只是补个简介' })
    expect(next.summary).toBe('只是补个简介')
    expect(next.stages).toEqual(planted.stages)
  })

  it('delete 幂等：坏形状/缺失 → false 不抛；存在 → true 且 unlink', () => {
    const p = mkTmpBook()
    expect(deletePlotline(p, '../../evil')).toBe(false)
    expect(deletePlotline(p, randomUUID())).toBe(false)
    const pl = createPlotline(p, { title: '删我' })
    expect(deletePlotline(p, pl.id)).toBe(true)
    expect(existsSync(plotlineFile(p, pl.id))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// choice：单值 chapterId 的「改到幻影才拒」规则（镜像 world.parentId）
// ---------------------------------------------------------------------------

describe('choice 仓库', () => {
  it('create 落盘 choices/<uuid>.yaml：默认 options 空；init 不能夹带 id/createdAt', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const c = createChoice(p, { title: '选边', chapterId: ch.id }, { id: 'evil', createdAt: '垃圾' })
    expect(c.id).toMatch(UUID_PATTERN)
    expect(c.createdAt).toMatch(ISO_RE)
    expect(c.options).toEqual([])
    expect(validateChoiceNodeV2(readYamlFile<unknown>(choiceAbs(p, c.id)))).toEqual([])
    expect(readYamlFile<unknown>(choiceAbs(p, c.id))).toEqual(c)
  })

  it('create 幻影 chapterId → REF_BROKEN 且零落盘；空白标题 → CHOICE_TITLE_INVALID 回显', () => {
    const p = mkTmpBook()
    const ghost = randomUUID()
    expect(() => createChoice(p, { title: '甲', chapterId: ghost })).toThrow(`REF_BROKEN: ${ghost}`)
    expect(existsSync(choicesDir(p))).toBe(false)
    expect(() => createChoice(p, { title: '\n', chapterId: ghost })).toThrow('CHOICE_TITLE_INVALID: \n')
  })

  it('update：改到幻影章 → REF_BROKEN 且字节不动；改到另一真实章 → 成功', () => {
    const p = mkTmpBook()
    const ch1 = createChapter(p, '一章')
    const ch2 = createChapter(p, '二章')
    const c = createChoice(p, { title: '岔路', chapterId: ch1.id })
    const rawBefore = readFileSync(choiceAbs(p, c.id), 'utf8')
    const ghost = randomUUID()
    expect(() => updateChoice(p, { ...c, chapterId: ghost })).toThrow(`REF_BROKEN: ${ghost}`)
    expect(readFileSync(choiceAbs(p, c.id), 'utf8')).toBe(rawBefore)
    expect(updateChoice(p, { ...c, chapterId: ch2.id }).chapterId).toBe(ch2.id)
  })

  it('update 存量悬挂 chapterId（章后来被删）+ 编辑选项 → 成功且悬挂原样保留', () => {
    const p = mkTmpBook()
    const gone = createChapter(p, '会被删的章')
    const c = createChoice(p, { title: '岔路', chapterId: gone.id })
    expect(deleteChapter(p, gone.id)).toBe(true) // 制造悬挂：目标章后来被删
    const next = updateChoice(p, { ...c, options: [{ label: '去', consequence: '' }] })
    expect(next.chapterId).toBe(gone.id)
    expect(next.options).toHaveLength(1)
  })

  it('update 守卫：BAD_CHOICE_ID / CHOICE_MISSING / 标题仅变化时校验', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '一章')
    const c = createChoice(p, { title: '岔路', chapterId: ch.id })
    expect(() => updateChoice(p, { ...c, id: '../evil' })).toThrow('BAD_CHOICE_ID: ../evil')
    expect(() => updateChoice(p, { ...c, id: randomUUID() })).toThrow(/CHOICE_MISSING: /)
    expect(updateChoice(p, { ...c }).title).toBe('岔路') // 回显原标题不触发标题门
    expect(() => updateChoice(p, { ...c, title: '  ' })).toThrow(`CHOICE_TITLE_INVALID: ${c.id}`)
  })

  it('delete 幂等 + list 容错跳坏档、createdAt 升序', () => {
    const p = mkTmpBook()
    expect(deleteChoice(p, 'not-uuid')).toBe(false)
    expect(deleteChoice(p, randomUUID())).toBe(false)
    const ch = createChapter(p, '一章')
    const c = createChoice(p, { title: '删我', chapterId: ch.id })
    expect(deleteChoice(p, c.id)).toBe(true)
    expect(existsSync(choiceAbs(p, c.id))).toBe(false)
    mkdirSync(choicesDir(p), { recursive: true })
    writeFileSync(choiceAbs(p, 'broken'), 'id: 不是uuid\n', 'utf8')
    const keep = createChoice(p, { title: '留下', chapterId: ch.id })
    expect(listChoices(p).map((x) => x.id)).toEqual([keep.id])
  })
})

// ---------------------------------------------------------------------------
// foreshadow 台账：单文件原子 RMW + 状态机
// ---------------------------------------------------------------------------

describe('readLedger + upsertForeshadow + writeLedger', () => {
  it('台账文件缺失 → {entries: []}（EMPTY 语义，不抛）', () => {
    const p = mkTmpBook()
    expect(readLedger(p)).toEqual({ entries: [] })
  })

  it('upsert：absent id 插入并落盘过校验；existing id 更新载荷字段', () => {
    const p = mkTmpBook()
    const e = mkEntry()
    const led = upsertForeshadow(p, e)
    expect(led.entries).toEqual([e])
    expect(
      validateForeshadowEntry(readYamlFile<ForeshadowLedger>(foreshadowFile(p)).entries[0])
    ).toEqual([])
    const led2 = upsertForeshadow(p, { ...e, title: '改名', note: '补注' })
    expect(led2.entries).toHaveLength(1)
    expect(led2.entries[0].title).toBe('改名')
    expect(led2.entries[0].note).toBe('补注')
  })

  it('upsert 不改机对状态：存量 resolved 档带 open 来 → 落盘仍 resolved（转移函数独占 status 写权）', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '回收章')
    const e = plantEntry(p)
    resolveForeshadow(p, e.id, ch.id)
    const after = upsertForeshadow(p, {
      ...e,
      status: 'open',
      resolvedChapterId: null,
      title: '编辑标题'
    })
    expect(after.entries[0].status).toBe('resolved')
    expect(after.entries[0].resolvedChapterId).toBe(ch.id)
    expect(after.entries[0].title).toBe('编辑标题')
  })

  it('upsert 守卫：坏形状 id → BAD_FORESHADOW_ID；坏档 → FORESHADOW_INVALID 且文件不落', () => {
    const p = mkTmpBook()
    expect(() => upsertForeshadow(p, mkEntry({ id: '../../evil' }))).toThrow(
      'BAD_FORESHADOW_ID: ../../evil'
    )
    expect(() => upsertForeshadow(p, mkEntry({ title: '' }))).toThrow(/FORESHADOW_INVALID/)
    expect(existsSync(foreshadowFile(p))).toBe(false)
  })

  it('writeLedger 原子写：操作后书根不留 .tmp- 残留', () => {
    const p = mkTmpBook()
    upsertForeshadow(p, mkEntry())
    writeLedger(p, { entries: [] })
    expect(readdirSync(p).filter((f) => f.includes('.tmp-'))).toEqual([])
    expect(readLedger(p)).toEqual({ entries: [] })
  })

  it('损坏台账：readLedger/upsert 抛 FORESHADOW_INVALID，绝不静默整写覆盖；字节不动', () => {
    const p = mkTmpBook()
    writeFileSync(foreshadowFile(p), 'entries:\n  - id: 不是uuid\n', 'utf8')
    const rawBefore = readFileSync(foreshadowFile(p), 'utf8')
    expect(() => readLedger(p)).toThrow(/FORESHADOW_INVALID/)
    expect(() => upsertForeshadow(p, mkEntry())).toThrow(/FORESHADOW_INVALID/)
    expect(readFileSync(foreshadowFile(p), 'utf8')).toBe(rawBefore)
  })
})

describe('foreshadow 状态机（全部边）', () => {
  // 合法边：open→resolved(resolve)、open→abandoned(abandon)、resolved→open、abandoned→open（reopen）。
  // 非法边：源状态不符 → FORESHADOW_TRANSITION: <id>；缺失 → FORESHADOW_MISSING；
  // 坏形状 → BAD_FORESHADOW_ID；resolve 携不存在章 id → REF_BROKEN。
  it('open→resolved：resolve 携存在章 id → status/resolvedChapterId 双落盘', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '回收章')
    const e = plantEntry(p)
    const led = resolveForeshadow(p, e.id, ch.id)
    expect(led.entries[0]).toEqual({ ...e, status: 'resolved', resolvedChapterId: ch.id })
    expect(readLedger(p).entries[0].status).toBe('resolved')
  })

  it('resolve 携幻影章 → REF_BROKEN: <章id>，台账逐字节不动', () => {
    const p = mkTmpBook()
    const e = plantEntry(p)
    const ghost = randomUUID()
    const rawBefore = readFileSync(foreshadowFile(p), 'utf8')
    expect(() => resolveForeshadow(p, e.id, ghost)).toThrow(`REF_BROKEN: ${ghost}`)
    expect(readFileSync(foreshadowFile(p), 'utf8')).toBe(rawBefore)
  })

  it('resolve 非法源状态：abandoned → FORESHADOW_TRANSITION；resolved 重复 resolve → 同样拒绝', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '回收章')
    const gone = plantEntry(p)
    abandonForeshadow(p, gone.id)
    expect(() => resolveForeshadow(p, gone.id, ch.id)).toThrow(`FORESHADOW_TRANSITION: ${gone.id}`)
    const done = plantEntry(p)
    resolveForeshadow(p, done.id, ch.id)
    expect(() => resolveForeshadow(p, done.id, ch.id)).toThrow(`FORESHADOW_TRANSITION: ${done.id}`)
  })

  it('open→abandoned；abandoned→open（reopen）', () => {
    const p = mkTmpBook()
    const e = plantEntry(p)
    expect(abandonForeshadow(p, e.id).entries[0].status).toBe('abandoned')
    expect(reopenForeshadow(p, e.id).entries[0].status).toBe('open')
  })

  it('resolved→open：reopen 置回 open 且 resolvedChapterId=null；resolved→abandoned 非法（先撤再弃）', () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '回收章')
    const e = plantEntry(p)
    resolveForeshadow(p, e.id, ch.id)
    expect(() => abandonForeshadow(p, e.id)).toThrow(`FORESHADOW_TRANSITION: ${e.id}`)
    const back = reopenForeshadow(p, e.id)
    expect(back.entries[0].status).toBe('open')
    expect(back.entries[0].resolvedChapterId).toBeNull()
  })

  it('其余守卫：open 上 reopen、abandoned 上再 abandon → FORESHADOW_TRANSITION；缺失 → FORESHADOW_MISSING；坏形状 → BAD_FORESHADOW_ID', () => {
    const p = mkTmpBook()
    const e = plantEntry(p)
    expect(() => reopenForeshadow(p, e.id)).toThrow(`FORESHADOW_TRANSITION: ${e.id}`)
    abandonForeshadow(p, e.id)
    expect(() => abandonForeshadow(p, e.id)).toThrow(`FORESHADOW_TRANSITION: ${e.id}`)
    const missing = randomUUID()
    expect(() => resolveForeshadow(p, missing, randomUUID())).toThrow(`FORESHADOW_MISSING: ${missing}`)
    expect(() => abandonForeshadow(p, missing)).toThrow(`FORESHADOW_MISSING: ${missing}`)
    expect(() => reopenForeshadow(p, '../evil')).toThrow('BAD_FORESHADOW_ID: ../evil')
  })

  it('resolve 存在性只认章集（refs.chapterIds）：指向存在的角色 id 也 REF_BROKEN', () => {
    const p = mkTmpBook()
    const car = createCharacter(p, { name: '阿明', gender: 'male', role: 'protagonist' })
    expect(chapterIds(p)).toEqual([])
    const e = plantEntry(p)
    expect(() => resolveForeshadow(p, e.id, car.id)).toThrow(`REF_BROKEN: ${car.id}`)
  })
})

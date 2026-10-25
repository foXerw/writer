// 叙事三域仓库（Task 8，仅数据层——录入 UI 按 M1 裁定随 M4）：
// - plotlines/<uuid>.yaml = PlotlineV2、choices/<uuid>.yaml = ChoiceNodeV2（一文件一实体，docStore 原子写）；
// - foreshadow.yaml = 单文件台账 {entries: ForeshadowEntry[]}——整读整写（RMW）经 writeLedger 原子落盘，
//   任何一次转移/合并都是「读→校验→改→原子替换」，绝不做半文件增量编辑。
// 主进程代码：相对导入 + node: 前缀。守卫/容错纪律逐条镜像 characters.ts（Task 6）/ world.ts（Task 7）：
// - list 侧单档损坏 console.warn（绝对路径）+ 跳过，绝不整体抛；按 createdAt 升序（同刻按 id）；
// - 文件名（stem）即 id 的唯一权威：parseDoc 以 stem 覆写 doc.id，update 写回同一路径，绝不改名；
// - 边界守卫：id 非 UUID → `BAD_PLOTLINE_ID`/`BAD_CHOICE_ID`/`BAD_FORESHADOW_ID`
//   （delete 按幂等契约返回 false 不抛——与章/卷/角色同一契约分裂）；update/转移缺档 → `*_MISSING`；
// - 标题门镜像角色 name/词条 title 门：空白/含换行 → `PLOTLINE_TITLE_INVALID`/`CHOICE_TITLE_INVALID`
//   （create 回显标题、update 带 id），且仅在与存量不同时校验（回显放行，存量坏形状不拦普通编辑）；
// - 写前一律 validatePlotlineV2/validateChoiceNodeV2/validateForeshadowEntry（坏形状 → `*_INVALID: …`）；
//   台账读侧 validateForeshadowLedger——损坏台账一律 FORESHADOW_INVALID 抛穿、拒绝整写覆盖
//   （「坏档允许报错、绝不静默改写」教义：单文件 RMW 若跳过坏条目，等于下次保存顺手删档）；
// - 引用检查经 refs.ts 单一定源（本文件零仓库导入，不成环）：
//   plotline stages[].chapterIds ⊆ refs.chapterIds、stages[].entityIds ⊆ refs.allEntityIds——数组多值字段，
//   按 Task 6 裁定 1「新边 vs 旧边」只拒本次新引入的幻影；choice.chapterId 单值字段镜像 world.parentId：
//   仅当「改到」幻影章才拒，存量悬挂（章后来被删）原样放行可编辑；
// - 伏笔状态机（Task 8 裁定，转移函数独占写权）：
//   open→resolved（resolveForeshadow，resolvedChapterId 必须是存在章 id，否则 REF_BROKEN）、
//   open→abandoned（abandonForeshadow）、resolved→open、abandoned→open（reopenForeshadow，
//   reopen 自 resolved 时 resolvedChapterId 复位 null）；源状态不符 → `FORESHADOW_TRANSITION: <id>`。
//   upsertForeshadow 对 existing id 永不改机对状态（status + resolvedChapterId 以存量为准，其余载荷字段
//   整份覆盖）；对 absent id 插入校验后的条目（机对初值由 schema 枚举把关，状态机只治「转移」）。
//   台账条目对 plantedChapterId 不做存在性检查（Task 8 裁定：伏笔先埋后写很常见，跨档悬挂由 UI 降级显示）。
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ChoiceNodeV2,
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineV2
} from '../../../src/common/schema'
import {
  UUID_PATTERN,
  validateChoiceNodeV2,
  validateForeshadowEntry,
  validateForeshadowLedger,
  validatePlotlineV2
} from '../../../src/common/schema'
import { choiceFile, choicesDir, foreshadowFile, plotlineFile, plotlinesDir } from './paths'
import { listYamlFiles, readYamlFile, writeYamlFileAtomic } from './docStore'
import { allEntityIds, chapterIds } from './refs'

const YAML_EXT = '.yaml'

/** PlotlineV2 的 create 必备字段走 seed，其余默认（init 覆盖纪律镜像 createWorldEntry）。 */
export interface PlotlineSeed {
  title: string
  summary?: string
  status?: PlotlineV2['status']
}

/** ChoiceNodeV2 的 create 必备字段（挂章是 choice 的存在方式，不给默认值——幻影在引用检查处拒）。 */
export interface ChoiceSeed {
  title: string
  chapterId: string
}

// ---------------------------------------------------------------------------
// 剧情线
// ---------------------------------------------------------------------------

/** createdAt 升序（同刻按 id）；损坏档 warn + 跳过。 */
export function listPlotlines(p: string): PlotlineV2[] {
  return loadAllPlotlines(p).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
}

/** 新建剧情线：一次原子写完成（seed + 默认 + init 覆盖 + 校验 + 引用检查同成败）。 */
export function createPlotline(p: string, seed: PlotlineSeed, init?: Partial<PlotlineV2>): PlotlineV2 {
  if (isInvalidTitle(seed.title)) {
    throw new Error(`PLOTLINE_TITLE_INVALID: ${seed.title}`) // create 场景回显标题（此时尚无 id）
  }
  const now = new Date().toISOString()
  const extras: Partial<PlotlineV2> = {}
  for (const [key, value] of Object.entries(init ?? {})) {
    if (value !== undefined) (extras as Record<string, unknown>)[key] = value
  }
  const doc: PlotlineV2 = {
    summary: seed.summary ?? '',
    status: seed.status ?? 'active',
    stages: [],
    ...extras,
    id: randomUUID(),
    title: seed.title,
    createdAt: now,
    updatedAt: now
  }
  assertValidPlotlineForWrite(doc)
  assertPlotlineReferences(p, doc, null)
  writeYamlFileAtomic(plotlineFile(p, doc.id), doc)
  return doc
}

/** 整档写入：标题仅变化时校验；引用检查「新边 vs 旧边」；updatedAt 仓库侧刷新、createdAt 以存量为准。 */
export function updatePlotline(p: string, full: PlotlineV2): PlotlineV2 {
  assertPlotlineId(full.id)
  const stored = loadPlotline(p, full.id) // 缺失 → PLOTLINE_MISSING；坏档 → PLOTLINE_INVALID 抛穿
  if (full.title !== stored.title && isInvalidTitle(full.title)) {
    throw new Error(`PLOTLINE_TITLE_INVALID: ${full.id}`)
  }
  const doc: PlotlineV2 = {
    ...full,
    id: full.id,
    createdAt: stored.createdAt, // 存量权威：渲染层回显垃圾值不进磁盘
    updatedAt: new Date().toISOString()
  }
  assertValidPlotlineForWrite(doc)
  assertPlotlineReferences(p, doc, stored)
  writeYamlFileAtomic(plotlineFile(p, full.id), doc)
  return doc
}

/** 删除 = 只删自己的档（不级联清理他档指向它的引用——悬挂由 UI 降级显示，M4 再治）。 */
export function deletePlotline(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false // 幂等契约优先于 BAD_PLOTLINE_ID 抛错（镜像 deleteChapter）
  const abs = plotlineFile(p, id)
  if (!existsSync(abs)) return false
  unlinkSync(abs)
  return true
}

// ---------------------------------------------------------------------------
// 关键选项
// ---------------------------------------------------------------------------

/** createdAt 升序（同刻按 id）；损坏档 warn + 跳过。 */
export function listChoices(p: string): ChoiceNodeV2[] {
  return loadAllChoices(p).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
}

export function createChoice(p: string, seed: ChoiceSeed, init?: Partial<ChoiceNodeV2>): ChoiceNodeV2 {
  if (isInvalidTitle(seed.title)) {
    throw new Error(`CHOICE_TITLE_INVALID: ${seed.title}`)
  }
  const now = new Date().toISOString()
  const extras: Partial<ChoiceNodeV2> = {}
  for (const [key, value] of Object.entries(init ?? {})) {
    if (value !== undefined) (extras as Record<string, unknown>)[key] = value
  }
  const doc: ChoiceNodeV2 = {
    options: [],
    ...extras,
    id: randomUUID(),
    title: seed.title,
    chapterId: seed.chapterId,
    createdAt: now,
    updatedAt: now
  }
  assertValidChoiceForWrite(doc)
  assertChoiceReferences(p, doc, null)
  writeYamlFileAtomic(choiceFile(p, doc.id), doc)
  return doc
}

export function updateChoice(p: string, full: ChoiceNodeV2): ChoiceNodeV2 {
  assertChoiceId(full.id)
  const stored = loadChoice(p, full.id)
  if (full.title !== stored.title && isInvalidTitle(full.title)) {
    throw new Error(`CHOICE_TITLE_INVALID: ${full.id}`)
  }
  const doc: ChoiceNodeV2 = {
    ...full,
    id: full.id,
    createdAt: stored.createdAt,
    updatedAt: new Date().toISOString()
  }
  assertValidChoiceForWrite(doc)
  assertChoiceReferences(p, doc, stored)
  writeYamlFileAtomic(choiceFile(p, full.id), doc)
  return doc
}

export function deleteChoice(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false
  const abs = choiceFile(p, id)
  if (!existsSync(abs)) return false
  unlinkSync(abs)
  return true
}

// ---------------------------------------------------------------------------
// 伏笔台账（单文件 RMW）
// ---------------------------------------------------------------------------

/** 台账缺失 → {entries: []}（EMPTY 语义）；损坏台账 → FORESHADOW_INVALID 抛穿（点侧不容错）。 */
export function readLedger(p: string): ForeshadowLedger {
  const abs = foreshadowFile(p)
  if (!existsSync(abs)) return { entries: [] }
  const v = readYamlFile<unknown>(abs) // YAML 本身坏了 → 抛穿（镜像「点读把 parse 错误抛给上层」分工）
  const errors = validateForeshadowLedger(v)
  if (errors.length > 0) {
    throw new Error(`FORESHADOW_INVALID: ${abs}: ${errors.join('; ')}`)
  }
  return v as ForeshadowLedger
}

/** 整本台账原子写（先校验后落盘——RMW 的「W」是坏数据进不了磁盘的最后闸门）。 */
export function writeLedger(p: string, ledger: ForeshadowLedger): void {
  const errors = validateForeshadowLedger(ledger)
  if (errors.length > 0) {
    throw new Error(`FORESHADOW_INVALID: ${foreshadowFile(p)}: ${errors.join('; ')}`)
  }
  writeYamlFileAtomic(foreshadowFile(p), ledger)
}

/**
 * upsert：absent id 插入（机对初值由 schema 枚举把关）；existing id 整份覆盖载荷字段，
 * 但 status + resolvedChapterId 一律以存量为准——状态转移只认 resolve/abandon/reopen。
 */
export function upsertForeshadow(p: string, entry: ForeshadowEntry): ForeshadowLedger {
  assertForeshadowId(entry.id)
  const errors = validateForeshadowEntry(entry)
  if (errors.length > 0) {
    throw new Error(`FORESHADOW_INVALID: ${entry.id}: ${errors.join('; ')}`)
  }
  const ledger = readLedger(p) // 损坏台账 → 抛穿，绝不整写覆盖
  const stored = ledger.entries.find((e) => e.id === entry.id)
  const merged: ForeshadowEntry = stored
    ? { ...entry, status: stored.status, resolvedChapterId: stored.resolvedChapterId }
    : entry
  return replaceEntries(p, ledger, entry.id, merged)
}

/** open→resolved：机对（status/resolvedChapterId）同写；章不存在 → REF_BROKEN 先于任何写盘。 */
export function resolveForeshadow(
  p: string,
  id: string,
  resolvedChapterId: string
): ForeshadowLedger {
  assertForeshadowId(id)
  const ledger = readLedger(p)
  const entry = requireEntry(ledger, id)
  if (entry.status !== 'open') {
    throw new Error(`FORESHADOW_TRANSITION: ${id}`)
  }
  if (!chapterIds(p).includes(resolvedChapterId)) {
    throw new Error(`REF_BROKEN: ${resolvedChapterId}`)
  }
  return replaceEntries(p, ledger, id, { ...entry, status: 'resolved', resolvedChapterId })
}

/** open→abandoned。resolved→abandoned 非法（先 reopen 撤回复置，再弃——机对不允许「带账弃坑」）。 */
export function abandonForeshadow(p: string, id: string): ForeshadowLedger {
  assertForeshadowId(id)
  const ledger = readLedger(p)
  const entry = requireEntry(ledger, id)
  if (entry.status !== 'open') {
    throw new Error(`FORESHADOW_TRANSITION: ${id}`)
  }
  return replaceEntries(p, ledger, id, { ...entry, status: 'abandoned' })
}

/** resolved|abandoned→open：撤回回收指针（resolvedChapterId=null），伏笔回到未了状态。 */
export function reopenForeshadow(p: string, id: string): ForeshadowLedger {
  assertForeshadowId(id)
  const ledger = readLedger(p)
  const entry = requireEntry(ledger, id)
  if (entry.status === 'open') {
    throw new Error(`FORESHADOW_TRANSITION: ${id}`)
  }
  return replaceEntries(p, ledger, id, { ...entry, status: 'open', resolvedChapterId: null })
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function assertPlotlineId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new Error(`BAD_PLOTLINE_ID: ${id}`)
}

function assertChoiceId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new Error(`BAD_CHOICE_ID: ${id}`)
}

/** id 形状门：台账条目按 id 定位（非 UUID 不进机对操作——镜像 assertChapterId，幂等 false 只留给 delete）。 */
function assertForeshadowId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new Error(`BAD_FORESHADOW_ID: ${id}`)
}

/** 标题与章/卷/角色/词条同一口径：非空且不含换行。 */
function isInvalidTitle(title: string): boolean {
  return title.trim() === '' || /[\n\r]/.test(title)
}

function loadPlotline(p: string, id: string): PlotlineV2 {
  const abs = plotlineFile(p, id)
  if (!existsSync(abs)) throw new Error(`PLOTLINE_MISSING: ${id}`)
  return parsePlotline(readYamlFile<unknown>(abs), id, abs)
}

function loadChoice(p: string, id: string): ChoiceNodeV2 {
  const abs = choiceFile(p, id)
  if (!existsSync(abs)) throw new Error(`CHOICE_MISSING: ${id}`)
  return parseChoice(readYamlFile<unknown>(abs), id, abs)
}

function loadAllPlotlines(p: string): PlotlineV2[] {
  const dir = plotlinesDir(p)
  const docs: PlotlineV2[] = []
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    try {
      docs.push(parsePlotline(readYamlFile<unknown>(abs), name.slice(0, -YAML_EXT.length), abs))
    } catch (err) {
      console.warn(`跳过损坏剧情线文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return docs
}

function loadAllChoices(p: string): ChoiceNodeV2[] {
  const dir = choicesDir(p)
  const docs: ChoiceNodeV2[] = []
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    try {
      docs.push(parseChoice(readYamlFile<unknown>(abs), name.slice(0, -YAML_EXT.length), abs))
    } catch (err) {
      console.warn(`跳过损坏选项文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return docs
}

function parsePlotline(v: unknown, id: string, source: string): PlotlineV2 {
  const errors = validatePlotlineV2(v)
  if (errors.length > 0) {
    throw new Error(`PLOTLINE_INVALID: ${source}: ${errors.join('; ')}`)
  }
  const doc = v as PlotlineV2
  return { ...doc, id } // stem 权威：与 doc.id 不一致时以文件名回写
}

function parseChoice(v: unknown, id: string, source: string): ChoiceNodeV2 {
  const errors = validateChoiceNodeV2(v)
  if (errors.length > 0) {
    throw new Error(`CHOICE_INVALID: ${source}: ${errors.join('; ')}`)
  }
  const doc = v as ChoiceNodeV2
  return { ...doc, id }
}

function assertValidPlotlineForWrite(doc: PlotlineV2): void {
  const errors = validatePlotlineV2(doc)
  if (errors.length > 0) {
    throw new Error(`PLOTLINE_INVALID: ${doc.id}: ${errors.join('; ')}`)
  }
}

function assertValidChoiceForWrite(doc: ChoiceNodeV2): void {
  const errors = validateChoiceNodeV2(doc)
  if (errors.length > 0) {
    throw new Error(`CHOICE_INVALID: ${doc.id}: ${errors.join('; ')}`)
  }
}

/**
 * 剧情线引用检查（Task 6 裁定 1 的多值数组版）：只拒「本补丁新引入」的幻影——
 * 存量 stage 引用（章/实体后来被删）原样放行可编辑。目标集来自 refs 单一定源：
 * stages[].chapterIds ⊆ refs.chapterIds（严格章集），stages[].entityIds ⊆ refs.allEntityIds
 * （章 ∪ 角色 ∪ 卷 ∪ 词条，词条为宽容 stem 直扫）。入参 doc 已过 validatePlotlineV2，可安全迭代。
 */
function assertPlotlineReferences(p: string, next: PlotlineV2, prev: PlotlineV2 | null): void {
  const knownChapters = new Set<string>(chapterIds(p))
  const knownEntities = new Set<string>(allEntityIds(p))
  const previousChapters = new Set<string>()
  const previousEntities = new Set<string>()
  if (prev) {
    for (const s of prev.stages) {
      for (const cid of s.chapterIds) previousChapters.add(cid)
      for (const eid of s.entityIds) previousEntities.add(eid)
    }
  }
  for (const s of next.stages) {
    for (const cid of s.chapterIds) {
      if (!knownChapters.has(cid) && !previousChapters.has(cid)) {
        throw new Error(`REF_BROKEN: ${cid}`)
      }
    }
    for (const eid of s.entityIds) {
      if (!knownEntities.has(eid) && !previousEntities.has(eid)) {
        throw new Error(`REF_BROKEN: ${eid}`)
      }
    }
  }
}

/**
 * 选项引用检查（world.parentId 单值规则同款）：chapterId 只在「改变」时校验存在性——
 * 存量悬挂（挂的章后来被删）不改章就能继续编辑选项；改到幻影 → REF_BROKEN 先于任何写盘。
 * create 时 prev=null，任何幻影 chapterId 都是「新引入」→ 拒。
 */
function assertChoiceReferences(p: string, next: ChoiceNodeV2, prev: ChoiceNodeV2 | null): void {
  if (next.chapterId !== prev?.chapterId) {
    if (!chapterIds(p).includes(next.chapterId)) {
      throw new Error(`REF_BROKEN: ${next.chapterId}`)
    }
  }
}

function requireEntry(ledger: ForeshadowLedger, id: string): ForeshadowEntry {
  const entry = ledger.entries.find((e) => e.id === id)
  if (!entry) throw new Error(`FORESHADOW_MISSING: ${id}`)
  return entry
}

/** 台账替换的单一落盘点：替换/插入指定条目后整本原子写（writeLedger 校验闸门在后）。 */
function replaceEntries(
  p: string,
  ledger: ForeshadowLedger,
  id: string,
  entry: ForeshadowEntry
): ForeshadowLedger {
  const exists = ledger.entries.some((e) => e.id === id)
  const entries = exists
    ? ledger.entries.map((e) => (e.id === id ? entry : e))
    : [...ledger.entries, entry]
  const next: ForeshadowLedger = { entries }
  writeLedger(p, next)
  return next
}

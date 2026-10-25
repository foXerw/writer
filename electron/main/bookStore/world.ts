// v2 世界观词条仓库（Task 7）：world/<category>/<uuid>.yaml = WorldEntryV2，一文件一条目
// （category = SettingCategory 枚举目录 slug，文件名一律 `<id>.yaml`，docStore 原子写）。
// 主进程代码：相对导入 + node: 前缀。守卫/容错纪律逐条镜像 characters.ts（Task 6）：
// - listWorldEntries 单档损坏 console.warn（绝对路径）+ 跳过，绝不整体抛；按 createdAt 升序（同刻按 stem）；
// - 文件名（stem）即 id 的唯一权威：parseDoc 以 stem 覆写 doc.id，update 写回同一路径，绝不改名
//   （中文标题改字段不动文件名——v1「id-标题.json」 sanitize 改名病根在此根治）；
// - 边界守卫：id 非 UUID → `BAD_WORLD_ID: <id>`（delete 按幂等契约返回 false 不抛，契约分裂同章/卷/角色）；
//   update 缺失词条 → `WORLD_MISSING: <id>`；坏档点读 → `WORLD_INVALID` 抛穿（列表侧才容错）；
// - title 门镜像角色 name/卷 title 门：空白/含换行 → `WORLD_TITLE_INVALID`（create 回显标题，update 带 id），
//   且仅在与存量不同时校验（回显放行，存量坏形状不拦普通编辑）；
// - 写前一律 validateWorldEntryV2；时间戳一律 ISO 字符串，update 仓库侧刷新 updatedAt、createdAt 以存量为准；
// - 引用检查（镜像 Task 6 裁定 1，抛 `REF_BROKEN: <targetId>` 先于任何写盘，只拒「本次新引入」的幻影）：
//   parentId = 世界观层级专用字段，合法目标只认词条（不外扩到角色/卷；存在性检查，不查自指/成环——
//   与角色允许自链同一宽容，环状层级留 M4 整理）；links[] 目标集 = 角色 ∪ 卷 ∪ 词条（与 CharacterV2.links 同一集合）。
//   存量悬挂 parentId/link（当时合法、目标后来被删）必须原样保留且可继续编辑；delete 不级联清理；
// - 分类目录搬迁（本仓库特有）：category 改变 = 先原子写新路径、再尽力 unlink 旧路径。unlink 失败不抛错
//   （console.warn）——读侧兜底：list/get 对「同一 id 出现在多个分类目录」按 updatedAt 新者去重，刚写的新档
//   必然较新，故陈旧残影对上层不可见，仅磁盘留垃圾文件（M4 整理）；
// - 列表只认枚举分类目录（SettingCategory slug，未知目录整体忽略）；listWorldEntryIds 是全目录宽容直扫
//   （Task 6 characters 临时助手的单一定源替换——只认 stem 存在性、不校验内容，引用检查两侧共用此集合，
//   避免「宽容扫描」与「严格列表」的目标集分裂）。
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SettingCategory } from '../../../src/common/ipc'
import type { WorldEntryV2 } from '../../../src/common/schema'
import { SETTING_CATEGORIES, UUID_PATTERN, validateWorldEntryV2 } from '../../../src/common/schema'
import { worldDir, worldEntryFile } from './paths'
import { listYamlFiles, readYamlFile, writeYamlFileAtomic } from './docStore'
import { listCharacters } from './characters'
import { listVolumes } from './volumes'

const YAML_EXT = '.yaml'

/** create 的必备两字段 + 可选正文（其余走 init 覆盖；标题门镜像卷 title 门）。 */
export interface WorldSeed {
  title: string
  category: SettingCategory
  content?: string
}

/** createdAt 升序（同刻按 id 稳定）；损坏档 warn + 跳过；跨类重复 id 按 updatedAt 新者去重。 */
export function listWorldEntries(p: string): WorldEntryV2[] {
  return loadAll(p).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/**
 * 新建词条：seed（title/category/可选 content）+ 默认空字段 + ISO 时间戳；init（可选）覆盖正文编辑字段
 * ——setting:create 通道把渲染层整张 Partial 传进来（tags/order 等），新建因此一次原子写完成，
 * 绝不留「建了壳却没存下内容」的半态（镜像 createCharacter）。
 */
export function createWorldEntry(p: string, seed: WorldSeed, init?: Partial<WorldEntryV2>): WorldEntryV2 {
  if (isInvalidTitle(seed.title)) {
    throw new Error(`WORLD_TITLE_INVALID: ${seed.title}`) // create 场景回显标题（此时尚无 id）
  }
  const now = new Date().toISOString()
  // init = 渲染层整张 Partial：undefined 值键剔除；id/title/category/content/createdAt/updatedAt
  // 随后被显式键覆写（init 携带来的一律无效）
  const extras: Partial<WorldEntryV2> = {}
  for (const [key, value] of Object.entries(init ?? {})) {
    if (value !== undefined) (extras as Record<string, unknown>)[key] = value
  }
  const doc: WorldEntryV2 = {
    content: seed.content ?? '',
    parentId: null,
    order: 0,
    tags: [],
    links: [],
    ...extras,
    id: randomUUID(),
    title: seed.title,
    category: seed.category,
    createdAt: now,
    updatedAt: now
  }
  assertValidForWrite(doc)
  assertReferences(p, doc, null)
  writeYamlFileAtomic(worldEntryFile(p, doc.category, doc.id), doc)
  return doc
}

/**
 * 整条目写入（setting:update 通道语义）：标题仅变化时校验；引用检查用「新引用 vs 旧引用」；
 * category 改变时搬迁分类目录（写新 → 尽力删旧，见文件头裁定）；
 * updatedAt 仓库侧刷新、createdAt 以存量为准；一切校验先于写盘。
 */
export function updateWorldEntry(p: string, full: WorldEntryV2): WorldEntryV2 {
  assertWorldId(full.id)
  const { doc: stored, paths } = loadEntry(p, full.id) // 缺失 → WORLD_MISSING；坏档 → WORLD_INVALID 抛穿
  // 与章/卷/角色同一条件：只校验「新设定/改变」的标题，存量坏形状回显放行
  if (full.title !== stored.title && isInvalidTitle(full.title)) {
    throw new Error(`WORLD_TITLE_INVALID: ${full.id}`)
  }
  const doc: WorldEntryV2 = {
    ...full,
    id: full.id,
    createdAt: stored.createdAt, // 存量权威：渲染层回显垃圾值不进磁盘
    updatedAt: new Date().toISOString()
  }
  assertValidForWrite(doc)
  assertReferences(p, doc, stored)
  const canonical = worldEntryFile(p, doc.category, doc.id)
  writeYamlFileAtomic(canonical, doc)
  // 搬迁（或手改漂移：内容 category 与所在目录不符）：新档落定后才清旧路径。
  // updatedAt 已刷新 → 即便 unlink 失败，list/get 的去重也以新档为准，旧残影不可见。
  for (const stale of paths) {
    if (stale === canonical) continue
    try {
      unlinkSync(stale)
    } catch (err) {
      console.warn(
        `分类搬迁后旧世界观文件删除失败（列表按 updatedAt 去重兜底）: ${stale}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return doc
}

/**
 * 删除 = 只删自己的词条（不级联、不清理他人指向它的 parentId/links——UI 降级显示，M4 AI 整理再治）。
 * 幂等契约镜像 deleteCharacter：坏形状/缺失 → false 不抛；真实删除失败抛穿。
 */
export function deleteWorldEntry(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false // 幂等契约优先于 BAD_WORLD_ID 抛错（镜像 deleteChapter）
  const paths = locateFiles(p, id)
  if (paths.length === 0) return false // 幂等：缺失返回 false，不抛
  // 重复残留（搬迁 unlink 失败的跨类副本）也一并清理；任何一个 unlink 真实失败都抛穿
  // （幂等 false 只留给坏形状/缺失——镜像 deleteVolume「宁可删除失败，不可吞真实失败」）
  let firstError: unknown
  for (const abs of paths) {
    try {
      unlinkSync(abs)
    } catch (err) {
      firstError ??= err
    }
  }
  if (firstError !== undefined) throw firstError
  return true
}

/** 点读单词条：坏形状 id → BAD_WORLD_ID 抛；缺失 → null；坏档 → WORLD_INVALID 抛穿。 */
export function getWorldEntry(p: string, id: string): WorldEntryV2 | null {
  assertWorldId(id)
  const paths = locateFiles(p, id)
  if (paths.length === 0) return null
  return pickNewest(paths)
}

/**
 * 词条 id 宽容直扫（Task 6 characters 临时助手的单一定源，语义逐字保留）：
 * world/ 下任意子目录里的 `<stem>.yaml` 都算存在——只认 stem，不校验内容（轻），
 * 供角色/词条引用检查共用；目录整体缺失 → 空数组。
 */
export function listWorldEntryIds(p: string): string[] {
  const root = worldDir(p)
  if (!existsSync(root)) return []
  const ids: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const file of listYamlFiles(join(root, entry.name))) {
      ids.push(file.slice(0, -YAML_EXT.length))
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** id 形状门：文件名 = `<id>.yaml`，非 UUID 会经 join 路径重定向越出世界观目录（镜像 assertChapterId）。 */
function assertWorldId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`BAD_WORLD_ID: ${id}`)
  }
}

/** 词条 title 与章/卷/角色同一口径：非空且不含换行。 */
function isInvalidTitle(title: string): boolean {
  return title.trim() === '' || /[\n\r]/.test(title)
}

/** 只扫枚举分类目录，找出 `<id>.yaml` 的全部落点（搬迁残留时可能多于一处）。 */
function locateFiles(p: string, id: string): string[] {
  const found: string[] = []
  for (const category of SETTING_CATEGORIES) {
    const abs = worldEntryFile(p, category, id)
    if (existsSync(abs)) found.push(abs)
  }
  return found
}

/** 同 id 多落点时按 updatedAt 新者为准（与 loadAll 去重同一规则）；首个坏档把 WORLD_INVALID 抛穿。 */
function pickNewest(paths: string[]): WorldEntryV2 {
  let best: WorldEntryV2 | null = null
  for (const abs of paths) {
    const doc = parseDoc(readYamlFile<unknown>(abs), stemOf(abs), abs) // 坏档 → 抛穿（点读侧不容错）
    if (!best || best.updatedAt.localeCompare(doc.updatedAt) <= 0) best = doc
  }
  return best as WorldEntryV2
}

function stemOf(abs: string): string {
  return abs.slice(0, -YAML_EXT.length).replace(/^.*[\\/]/, '')
}

/** 列出全部枚举分类目录的 *.yaml 并校验；坏档 warn + 跳过；跨类重复 id 保留 updatedAt 较新的一份。 */
function loadAll(p: string): WorldEntryV2[] {
  const byId = new Map<string, WorldEntryV2>()
  for (const category of SETTING_CATEGORIES) {
    const dir = join(worldDir(p), category)
    for (const name of listYamlFiles(dir)) {
      const abs = join(dir, name)
      try {
        // 文件名 stem 是 id 的唯一权威（镜像 chapters/volumes/characters「以文件名为准」）
        const doc = parseDoc(readYamlFile<unknown>(abs), name.slice(0, -YAML_EXT.length), abs)
        const prev = byId.get(doc.id)
        if (!prev || prev.updatedAt.localeCompare(doc.updatedAt) <= 0) byId.set(doc.id, doc)
      } catch (err) {
        console.warn(`跳过损坏世界观文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  return [...byId.values()]
}

/** 点读侧「缺失 → WORLD_MISSING」+ 内容加载。 */
function loadEntry(p: string, id: string): { doc: WorldEntryV2; paths: string[] } {
  const paths = locateFiles(p, id)
  if (paths.length === 0) {
    throw new Error(`WORLD_MISSING: ${id}`)
  }
  return { doc: pickNewest(paths), paths }
}

function parseDoc(v: unknown, id: string, source: string): WorldEntryV2 {
  const errors = validateWorldEntryV2(v)
  if (errors.length > 0) {
    throw new Error(`WORLD_INVALID: ${source}: ${errors.join('; ')}`)
  }
  const doc = v as WorldEntryV2
  return { ...doc, id } // stem 权威：与 doc.id 不一致时以文件名回写
}

function assertValidForWrite(doc: WorldEntryV2): void {
  const errors = validateWorldEntryV2(doc)
  if (errors.length > 0) {
    throw new Error(`WORLD_INVALID: ${doc.id}: ${errors.join('; ')}`)
  }
}

/**
 * 引用检查（镜像 Task 6 裁定 1）：只拒绝「本次补丁新引入」的幻影 targetId——
 * 存量悬挂的 parentId/link（对方后来被删）原样放行，保证删除任一实体后指向它的词条仍全部可编辑。
 * parentId 只认词条集合（世界层级）；link 目标集 = 角色 ∪ 卷 ∪ 词条。存在性检查（宽容）：
 * 不查自指/成环——update 时自身已在词条集内，与角色自链同一口径，层级整理留 M4。
 * 入参 doc 已过 validateWorldEntryV2（数组/字符串形状有保证），可安全迭代。
 */
function assertReferences(p: string, next: WorldEntryV2, prev: WorldEntryV2 | null): void {
  const knownWorldIds = listWorldEntryIds(p)

  if (next.parentId !== null && next.parentId !== prev?.parentId) {
    if (!knownWorldIds.includes(next.parentId)) {
      throw new Error(`REF_BROKEN: ${next.parentId}`)
    }
  }

  const knownLinkTargets = new Set<string>([
    ...listCharacters(p).map((c) => c.id),
    ...listVolumes(p).map((v) => v.id),
    ...knownWorldIds
  ])
  const previousTargets = new Set<string>()
  if (prev) {
    for (const link of prev.links) previousTargets.add(link.targetId)
  }
  for (const link of next.links) {
    if (!knownLinkTargets.has(link.targetId) && !previousTargets.has(link.targetId)) {
      throw new Error(`REF_BROKEN: ${link.targetId}`)
    }
  }
}

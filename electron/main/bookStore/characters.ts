// v2 人物卡仓库（Task 6）：characters/<uuid>.yaml = CharacterV2，一文件一卡（docStore 原子写）。
// 主进程代码：相对导入 + node: 前缀。守卫/容错纪律逐条镜像 chapters.ts（Task 4）/ volumes.ts（Task 5）：
// - listCharacters 单档损坏 console.warn（绝对路径）+ 跳过，绝不整体抛；按 createdAt 升序（同刻按 stem）；
// - 文件名（stem）即 id 的唯一权威：parseDoc 以 stem 覆写 doc.id，update 写回同一路径，绝不改名；
// - 边界守卫：id 非 UUID → `BAD_CHARACTER_ID: <id>`（delete 按幂等契约返回 false 不抛，
//   与 chapters/volumes 同一契约分裂）；update 缺失卡 → `CHARACTER_MISSING: <id>`；
// - 名字门镜像章/卷 title 门：空白/含换行 → `CHARACTER_NAME_INVALID`（create 回显名字，
//   update 带 id），且仅在与存量不同时校验（回显放行，存量坏形状不拦普通编辑）；
// - 写前一律 validateCharacterV2（坏形状 → `CHARACTER_INVALID: <id|abs>: …`），点读侧把坏档抛穿，
//   列表侧 warn+跳过——与章「列表容错、点读抛穿」同一分工；
// - 引用检查（控制器裁定 1，抛 `REF_BROKEN: <targetId>` 先于任何写盘）：比较「本补丁的新边」与
//   「存量已存的旧边」——只拒绝本次新引入的幻影 targetId；存量悬挂边（对方后来被删）必须原样保留且
//   可继续编辑（否则任何一次删除都会把指向它的全部卡永久锁死）。合法目标集 = 本书角色 ∪ 卷 ∪
//   世界观词条（Task 8 起由 refs.ts 单一定源，卷/词条为 stem 直扫）；arc[].chapterIds 对章 id 同一规则。
//   删除不做级联清理（他人 edges 保留，UI 降级显示「已删除角色」，M4 AI 整理再治）；
// - 时间戳：一律 ISO 字符串；updateCharacter 仓库侧刷新 updatedAt、createdAt 以存量为准
//   （渲染层回显垃圾值不影响落盘）。
//
// Task 9 域缓存（裁定 1）：模块级 `Map<projectPath, CharacterV2[]>`，契约逐条镜像 chapters.ts
// （代表实现+测试钉死在 chapters）：list/get 命中缓存零 IO（list 返回浅拷贝）、缓存只在 list 侧
// 惰性填充、mutation 先写盘再就地更新缓存（RMW 的读一律直读磁盘）、`invalidateCache` 只清 characters 域；
// getCharacter 命中缓存时坏档为 null 而非 CHARACTER_INVALID 抛穿（缓存里只有解析成功的档）。
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CharacterGender, CharacterRole } from '../../../src/common/ipc'
import type { CharacterV2 } from '../../../src/common/schema'
import { UUID_PATTERN, validateCharacterV2 } from '../../../src/common/schema'
import { characterFile, charactersDir } from './paths'
import { listYamlFiles, readYamlFile, writeYamlFileAtomic } from './docStore'
import { listChapters } from './chapters'
// Task 8 环拆重构：卷/词条 id 直扫改从 refs 单一定源导入（曾直接从 world.ts/volumes.ts 取函数，
// 与 world.ts → characters.ts 构成函数级循环；refs.ts 零仓库导入，任何仓库引它都不成环）。
import { volumeIds, worldIds } from './refs'

const YAML_EXT = '.yaml'

/** createdAt 升序（同刻按 id 稳定）——list 填充与 create 就地插入共用同一比较器（改动需同步）。 */
function byCreatedAt(a: CharacterV2, b: CharacterV2): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** Task 9 域缓存：projectPath → 与磁盘一致的 createdAt 升序列表（mutation 就地维护；invalidateCache 整域清空）。 */
const listCache = new Map<string, CharacterV2[]>()

/** 清空 characters 域缓存（下次 listCharacters 重读磁盘）——只治本域（裁定 1，镜像 chapters.invalidateCache）。 */
export function invalidateCache(p: string): void {
  listCache.delete(p)
}

/** create 的必备三字段（其余走 init 覆盖；名字门镜像章 title 门）。 */
export interface CharacterSeed {
  name: string
  gender: CharacterGender
  role: CharacterRole
}

/** createdAt 升序（同刻按 stem 稳定）；损坏档 warn + 跳过；命中缓存零 IO（Task 9 裁定 1）。 */
export function listCharacters(p: string): CharacterV2[] {
  const cached = listCache.get(p)
  if (cached) return [...cached]
  const list = loadAll(p).sort(byCreatedAt)
  listCache.set(p, list)
  return [...list]
}

/**
 * 新建卡：seed 三字段 + 默认空字段 + ISO 时间戳；init（可选）覆盖正文编辑字段
 * ——character:create 通道把渲染层整张 Partial 传进来，新建因此一次原子写完成
 * （创建+校验+引用检查同成败，绝不留「建了壳却没存下内容」的半态）。
 */
export function createCharacter(
  p: string,
  seed: CharacterSeed,
  init?: Partial<CharacterV2>
): CharacterV2 {
  if (isInvalidName(seed.name)) {
    throw new Error(`CHARACTER_NAME_INVALID: ${seed.name}`) // create 场景回显名字（此时尚无 id）
  }
  const now = new Date().toISOString()
  // init = 渲染层整张 Partial：undefined 值键剔除；id/name/gender/role/createdAt/updatedAt
  // 随后被显式键覆写（init 携带来的一律无效）
  const extras: Partial<CharacterV2> = {}
  for (const [key, value] of Object.entries(init ?? {})) {
    if (value !== undefined) (extras as Record<string, unknown>)[key] = value
  }
  const doc: CharacterV2 = {
    age: 0,
    appearance: '',
    personality: '',
    background: '',
    relationships: [],
    arc: [],
    tags: [],
    links: [],
    ...extras,
    id: randomUUID(),
    name: seed.name,
    gender: seed.gender,
    role: seed.role,
    createdAt: now,
    updatedAt: now
  }
  assertValidForWrite(doc)
  assertReferences(p, doc, null)
  writeYamlFileAtomic(characterFile(p, doc.id), doc)
  // 先写盘、后就地更新缓存（Task 9 裁定 1）：createdAt=now 通常最大，仍统一重排（同刻按 id 稳定）
  const cached = listCache.get(p)
  if (cached) {
    cached.push(doc)
    cached.sort(byCreatedAt)
  }
  return doc
}

/**
 * 整卡写入（character:update 通道语义）：名字仅变化时校验；引用检查用「新边 vs 旧边」；
 * updatedAt 仓库侧刷新、createdAt 以存量为准；一切校验先于写盘。
 */
export function updateCharacter(p: string, full: CharacterV2): CharacterV2 {
  assertCharacterId(full.id)
  const stored = loadCharacter(p, full.id) // 缺失 → CHARACTER_MISSING；坏档 → CHARACTER_INVALID 抛穿
  // 与章/卷 title 门同一条件：只校验「新设定/改变」的名字，存量坏形状回显放行
  if (full.name !== stored.name && isInvalidName(full.name)) {
    throw new Error(`CHARACTER_NAME_INVALID: ${full.id}`)
  }
  const doc: CharacterV2 = {
    ...full,
    id: full.id,
    createdAt: stored.createdAt, // 存量权威：渲染层垃圾/陈旧 createdAt 不进磁盘
    updatedAt: new Date().toISOString()
  }
  assertValidForWrite(doc)
  assertReferences(p, doc, stored)
  writeYamlFileAtomic(characterFile(p, full.id), doc)
  // 就地整元素替换（createdAt 不变 → 排序保持）；缓存缺本卡 = 外部直写漂移 → 补入重排（镜像 chapters.applyPatch）
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((c) => c.id === full.id)
    if (idx !== -1) {
      cached[idx] = doc
    } else {
      cached.push(doc)
      cached.sort(byCreatedAt)
    }
  }
  return doc
}

/**
 * 删除 = 只删自己的卡（不级联、不清理他人指向它的 relationships/links——控制器裁定：
 * 引用清理留 M4 AI 整理；UI 把悬挂边降级显示为「已删除角色」）。
 */
export function deleteCharacter(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false // 幂等契约优先于 BAD_CHARACTER_ID 抛错（镜像 deleteChapter）
  const abs = characterFile(p, id)
  if (!existsSync(abs)) return false // 幂等：缺失返回 false，不抛
  unlinkSync(abs)
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((c) => c.id === id)
    if (idx !== -1) cached.splice(idx, 1) // 就地同步：缓存 == 刚写定的磁盘状态
  }
  return true
}

/**
 * 点读单卡：坏形状 id → BAD_CHARACTER_ID 抛；缺失 → null；坏档 → CHARACTER_INVALID 抛穿。
 * Task 9：命中缓存直接返回（缓存里只有解析成功的档——坏档在此路径为 null，抛穿契约只在磁盘路径兑现）。
 */
export function getCharacter(p: string, id: string): CharacterV2 | null {
  assertCharacterId(id)
  const cached = listCache.get(p)
  if (cached) return cached.find((c) => c.id === id) ?? null
  const abs = characterFile(p, id)
  if (!existsSync(abs)) return null
  return parseDoc(readYamlFile<unknown>(abs), id, abs)
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** id 形状门：文件名 = `<id>.yaml`，非 UUID 会经 join 路径重定向越出角色目录（镜像 assertChapterId）。 */
function assertCharacterId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`BAD_CHARACTER_ID: ${id}`)
  }
}

/** 人物名与章/卷 title 同一口径：非空且不含换行。 */
function isInvalidName(name: string): boolean {
  return name.trim() === '' || /[\n\r]/.test(name)
}

function loadCharacter(p: string, id: string): CharacterV2 {
  const abs = characterFile(p, id)
  if (!existsSync(abs)) {
    throw new Error(`CHARACTER_MISSING: ${id}`)
  }
  return parseDoc(readYamlFile<unknown>(abs), id, abs)
}

/** 列出目录全部 *.yaml 并校验；坏档 console.warn + 跳过（列表侧容错）。 */
function loadAll(p: string): CharacterV2[] {
  const dir = charactersDir(p)
  const docs: CharacterV2[] = []
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    try {
      // 文件名 stem 是 id 的唯一权威（镜像 chapters/volumes「以文件名为准」）
      docs.push(parseDoc(readYamlFile<unknown>(abs), name.slice(0, -YAML_EXT.length), abs))
    } catch (err) {
      console.warn(`跳过损坏角色文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return docs
}

function parseDoc(v: unknown, id: string, source: string): CharacterV2 {
  const errors = validateCharacterV2(v)
  if (errors.length > 0) {
    throw new Error(`CHARACTER_INVALID: ${source}: ${errors.join('; ')}`)
  }
  const doc = v as CharacterV2
  return { ...doc, id } // stem 权威：与 doc.id 不一致时以文件名回写
}

function assertValidForWrite(doc: CharacterV2): void {
  const errors = validateCharacterV2(doc)
  if (errors.length > 0) {
    throw new Error(`CHARACTER_INVALID: ${doc.id}: ${errors.join('; ')}`)
  }
}

/**
 * 引用检查（裁定 1）：只拒绝「本次补丁新引入」的幻影 targetId——
 * 存量旧边（relationships/links 的 targetId、arc[].chapterIds 的章 id）即使已悬挂也原样放行，
 * 保证删除任一实体后，指向它的卡仍全部可编辑。合法目标集 = 角色 ∪ 卷 ∪ 世界观词条；章 id 单独成集。
 * 入参 doc 已过 validateCharacterV2（数组/字符串形状有保证），可安全迭代。
 */
function assertReferences(p: string, next: CharacterV2, prev: CharacterV2 | null): void {
  const knownTargets = new Set<string>([
    ...loadAll(p).map((c) => c.id),
    ...volumeIds(p),
    ...worldIds(p)
  ])
  const previousTargets = new Set<string>()
  if (prev) {
    for (const link of [...prev.relationships, ...prev.links]) previousTargets.add(link.targetId)
  }
  for (const link of [...next.relationships, ...next.links]) {
    if (!knownTargets.has(link.targetId) && !previousTargets.has(link.targetId)) {
      throw new Error(`REF_BROKEN: ${link.targetId}`)
    }
  }

  const knownChapters = new Set<string>(listChapters(p).map((c) => c.id))
  const previousChapterIds = new Set<string>()
  if (prev) {
    for (const stage of prev.arc) for (const cid of stage.chapterIds) previousChapterIds.add(cid)
  }
  for (const stage of next.arc) {
    for (const cid of stage.chapterIds) {
      if (!knownChapters.has(cid) && !previousChapterIds.has(cid)) {
        throw new Error(`REF_BROKEN: ${cid}`)
      }
    }
  }
}

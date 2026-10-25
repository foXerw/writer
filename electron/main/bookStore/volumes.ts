// v2 卷仓库（Task 5）：volumes/<uuid>.yaml = VolumeDoc{id,title,order}，一文件一卷。
// 主进程代码：相对导入 + node: 前缀。守卫/容错纪律逐条镜像 chapters.ts（Task 4）：
// - listVolumes 单档损坏 console.warn + 跳过，绝不整体抛；按 order 升序（同序按 id 稳定）；
// - 文件名（stem）即 id 的唯一权威：列出时以 stem 覆写 doc.id（与章节「meta.id 与文件名不一致
//   以文件名为准」同义），rename/reorder/delete 写回读到的同一路径，绝不改名；
// - 边界守卫：id 非 UUID → `BAD_VOLUME_ID: <id>`（delete 按幂等契约返回 false 不抛）；
//   更新缺失卷 → `VOLUME_MISSING: <id>`；title 仅在与存量不同时校验（回显放行），
//   空白/含换行 → `VOLUME_TITLE_INVALID`（create 回显 title，rename 带 id），先于任何写盘抛；
// - order = 稠密 1..n：create 追加 max+1，reorderVolumes 重排后重编号（只重写 order 变化者）；
//   delete 留空洞无害（列表按 order 升序消费，稠密化只在 create/reorder 兑现——避免删一卷
//   重写全卷目录的写放大，与「moveChapter 只重写变化文件」同一最小写纪律的取舍）；
// - moveChapterToVolume = updateChapter 的 meta-only patch（content 缺省 → 正文逐字节不动）；
//   目标卷必须存在（null = 未分卷），封死「章指向幻影卷后在树上隐身」的孤儿引用；
// - deleteVolume 无孤儿保证（Review Focus 5）：先把其下每章 volumeId→null（逐章 meta-only 写），
//   任何一章更新抛错即整体中止——卷文件绝不先行删除，宁可删除失败，不可制造孤儿。
//
// Task 9 域缓存（裁定 1）：模块级 `Map<projectPath, VolumeDoc[]>`，契约逐条镜像 chapters.ts
// （代表实现+测试钉死在 chapters）：list 命中缓存零 IO（返回浅拷贝）、缓存只在 list 侧惰性填充、
// mutation 先写盘再就地更新缓存、`invalidateCache(projectPath)` 只清 volumes 域。
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Chapter } from '../../../src/common/ipc'
import type { VolumeDoc } from '../../../src/common/schema'
import { UUID_PATTERN, validateVolumeDoc } from '../../../src/common/schema'
import { volumeFile, volumesDir } from './paths'
import { listYamlFiles, readYamlFile, writeYamlFileAtomic } from './docStore'
import { listChapters, updateChapter } from './chapters'

const YAML_EXT = '.yaml'

/** Task 9 域缓存：projectPath → 与磁盘一致的 order 升序列表（mutation 就地维护；invalidateCache 整域清空）。 */
const listCache = new Map<string, VolumeDoc[]>()

/** 清空 volumes 域缓存（下次 listVolumes 重读磁盘）——只治本域（裁定 1，镜像 chapters.invalidateCache）。 */
export function invalidateCache(p: string): void {
  listCache.delete(p)
}

/** order 升序（同序按 id 稳定）；损坏档 warn + 跳过；命中缓存零 IO（Task 9 裁定 1）。 */
export function listVolumes(p: string): VolumeDoc[] {
  const cached = listCache.get(p)
  if (cached) return [...cached]
  const list = loadAll(p).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  listCache.set(p, list)
  return [...list]
}

export function createVolume(p: string, title: string): VolumeDoc {
  if (isInvalidTitle(title)) {
    throw new Error(`VOLUME_TITLE_INVALID: ${title}`) // create 场景回显 title（此时尚无 id）
  }
  const docs = loadAll(p)
  const order = docs.reduce((max, d) => Math.max(max, d.order), 0) + 1 // 稠密追加
  const doc: VolumeDoc = { id: randomUUID(), title, order }
  writeYamlFileAtomic(volumeFile(p, doc.id), doc)
  // 先写盘、后就地更新缓存（Task 9 裁定 1）：order = max+1 → 追加尾端即保持升序
  const cached = listCache.get(p)
  if (cached) cached.push(doc)
  return doc
}

export function renameVolume(p: string, id: string, newTitle: string): VolumeDoc {
  assertVolumeId(id)
  const current = loadVolume(p, id) // 缺失 → VOLUME_MISSING
  // 与 chapters.applyPatch 同一条件：只校验「新设定/改变」的 title，存量坏形状回显放行
  if (newTitle !== current.title && isInvalidTitle(newTitle)) {
    throw new Error(`VOLUME_TITLE_INVALID: ${id}`)
  }
  const doc: VolumeDoc = { ...current, title: newTitle }
  writeYamlFileAtomic(volumeFile(p, id), doc)
  // 就地整元素替换（order 不变 → 排序保持）；缓存缺本卷 = 外部直写漂移 → 补入重排（镜像 chapters.applyPatch）
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((v) => v.id === id)
    if (idx !== -1) {
      cached[idx] = doc
    } else {
      cached.push(doc)
      cached.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    }
  }
  return doc
}

/**
 * 删除卷 = 「先疏散、后删档」：其下每章 volumeId→null 全部写成功后才 unlink。
 * 任何一章更新抛错（坏 front-matter 点写抛穿）→ 原样抛、卷文件保留（幂等 false 仅对
 * 坏形状/缺失 id，不吞真实删除失败）。
 */
export function deleteVolume(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false // 幂等契约优先于 BAD_VOLUME_ID 抛错（镜像 deleteChapter）
  const abs = volumeFile(p, id)
  if (!existsSync(abs)) return false // 幂等：缺失返回 false，不抛
  for (const c of listChapters(p)) {
    if (c.volumeId === id) {
      updateChapter(p, c.id, { volumeId: null }) // meta-only：正文逐字节不动（章域缓存由其就地维护）
    }
  }
  unlinkSync(abs)
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((v) => v.id === id)
    if (idx !== -1) cached.splice(idx, 1) // 就地同步：缓存 == 刚写定的磁盘状态
  }
  return true
}

/** 把 fromId 移到 toId 所在槽位（语义同 chapter:reorder 的 fromId/toId），order 重编稠密 1..n。 */
export function reorderVolumes(p: string, fromId: string, toId: string): boolean {
  assertVolumeId(fromId)
  if (!UUID_PATTERN.test(toId)) return false
  const docs = listVolumes(p)
  const fromIdx = docs.findIndex((d) => d.id === fromId)
  const toIdx = docs.findIndex((d) => d.id === toId)
  if (fromIdx === -1 || toIdx === -1) return false

  const [moved] = docs.splice(fromIdx, 1)
  docs.splice(toIdx, 0, moved) // 目标槽位是「to 当前位置」；相邻即交换，无需钳位
  docs.forEach((d, i) => {
    const order = i + 1
    if (d.order !== order) {
      writeYamlFileAtomic(volumeFile(p, d.id), { ...d, order }) // 只重写变化者
    }
  })
  // 重排落盘后整条重建缓存条目（docs 此刻与磁盘逐一对应，order 按新位次）——就地同步（Task 9 裁定 1）
  if (listCache.has(p)) {
    listCache.set(p, docs.map((d, i) => ({ ...d, order: i + 1 })))
  }
  return true
}

/** 改章的卷归属（meta-only patch）；volumeId=null = 未分卷。目标卷必须存在，杜绝幻影卷隐身章。 */
export function moveChapterToVolume(p: string, chapterId: string, volumeId: string | null): Chapter {
  if (volumeId !== null) {
    assertVolumeId(volumeId)
    if (!existsSync(volumeFile(p, volumeId))) {
      throw new Error(`VOLUME_MISSING: ${volumeId}`)
    }
  }
  return updateChapter(p, chapterId, { volumeId })
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** id 形状门：文件名 = `<id>.yaml`，非 UUID 会经 join 路径重定向越出卷目录（镜像 assertChapterId）。 */
function assertVolumeId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`BAD_VOLUME_ID: ${id}`)
  }
}

/** 卷 title 与章 title 同一口径：非空且不含换行（front-matter/YAML 单行假设）。 */
function isInvalidTitle(title: string): boolean {
  return title.trim() === '' || /[\n\r]/.test(title)
}

/** 点读单卷：缺失 → VOLUME_MISSING；损坏（YAML 坏/校验不过）把读错抛穿——与章节点写侧同一分工。 */
function loadVolume(p: string, id: string): VolumeDoc {
  const abs = volumeFile(p, id)
  if (!existsSync(abs)) {
    throw new Error(`VOLUME_MISSING: ${id}`)
  }
  return parseDoc(readYamlFile<unknown>(abs), id, abs)
}

/** 列出目录全部 *.yaml 并校验；坏档 console.warn + 跳过（列表侧容错）。 */
function loadAll(p: string): VolumeDoc[] {
  const dir = volumesDir(p)
  const docs: VolumeDoc[] = []
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    const stem = name.slice(0, -YAML_EXT.length)
    try {
      // 文件名 stem 是 id 的唯一权威（镜像 chapters「以文件名为准」）
      docs.push(parseDoc(readYamlFile<unknown>(abs), stem, abs))
    } catch (err) {
      console.warn(`跳过损坏卷文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return docs
}

function parseDoc(v: unknown, id: string, source: string): VolumeDoc {
  const errors = validateVolumeDoc(v)
  if (errors.length > 0) {
    throw new Error(`VOLUME_INVALID: ${source}: ${errors.join('; ')}`)
  }
  const doc = v as VolumeDoc
  return { ...doc, id } // stem 权威：校验通过的 doc.id 与 stem 不一致时以 stem 回写
}

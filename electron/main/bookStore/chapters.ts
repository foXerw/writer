// v2 章节仓库（Task 4）：chapters/<uuid>.md = front-matter(meta) + 正文(body)。
// 主进程代码：相对导入 + node: 前缀。渲染层 Chapter.content 自此 = body（不含 front-matter），
// title/status/order/volumeId 全部来自 meta——v1 的「文件名当数据」字符串手术在此终结。
// 契约：
// - listChapters 单文件 parse 失败 console.warn + 跳过，绝不整体抛（一本坏章不让全书列表瘫痪）；
//   分工契约（评审裁定）：列表侧容错跳过，点读写侧（getChapter/updateChapter）对坏档把
//   `FRONTMATTER_*` 抛穿渲染层——坏章允许报错，绝不静默改写；
// - updateChapter/renameChapter 对缺失 id 抛 `CHAPTER_MISSING: <id>`（v1 静默写新文件的行为被禁）；
// - 仓库边界守卫（评审整改）：id 必须匹配 UUID_PATTERN，否则 `BAD_CHAPTER_ID: <id>`
//   （deleteChapter 按幂等契约返回 false）——封死 v1 遗留的 `../` join 路径重定向；
//   title 空白或含 \n/\r → `CHAPTER_TITLE_INVALID`，先于任何写盘抛（create 回显 title，
//   update/rename 带 id）；update 仅校验「相对存量改变」的 title——未变的回显放行
//   （存量坏形状标题不拦普通自动保存，与 H1 同步同一条件）；
// - 文件名（stem）即 id 的唯一权威：update/rename 写回读到的同一路径，绝不改名；
// - moveChapter 重排后 order 重编为稠密 1..n（3.5 评审：碰撞场景靠稠密重编号扑灭）；
// - title 变化（update patch 带 title 或 rename）：body 首非空行以 `# ` 开头 → 只替换该行
//   （其余字节含 CRLF 原样），首非空行非 H1 → body 不动（不伪造 H1，title 只活在 front-matter）。
//
// Task 9 域缓存（裁定 1，五仓库同一契约，本文件是代表实现——测试钉死见 chapters.test.ts「缓存语义」）：
// - 模块级 `Map<projectPath, Chapter[]>`：listChapters/getChapter 命中缓存直接返回（首次访问单次 IO），
//   list 返回浅拷贝（调用方可自由排序，缓存本体不受污染）；缓存只在 list 侧惰性填充（空目录也缓存 []）；
// - 一切 MUTATION（create/update/rename/delete/move）先写磁盘（原子路径不变），再就地更新缓存条目——
//   mutation 后缓存条目必须与刚写盘的字节一致（RMW 的「读」一律直读磁盘，缓存绝不进写路径）；
// - `invalidateCache(projectPath)` 只清 chapters 域：watcher 外部变更事件按域调用、stopWatching 全清；
// - 直写磁盘绕过仓库（测试/外部编辑器）不会被缓存感知——生产环境由 watcher 失效兜底，这是接受的陈旧窗口；
// - getChapter 缓存只短路「正命中」（修订 ②）：缓存缺 id ≠ 不存在——坏档被 list 侧跳过/外部直写漂移
//   都造成缺席，一律回落磁盘路径，点读契约（缺失 null / 坏档 FRONTMATTER_* 抛穿）与无缓存时逐字一致；
//   `bypassCache: true` 无条件直读磁盘（修订 ① 冲突判定专用：要此刻的磁盘真相，不要缓存权威）。
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Chapter } from '../../../src/common/ipc'
import type { ChapterMeta } from '../../../src/common/schema'
import { UUID_PATTERN } from '../../../src/common/schema'
import { parseChapterDoc, serializeChapterDoc } from '../../../src/common/chapterDoc'
import { countWords } from '../../../src/common/wordCount'
import { chapterFile, chaptersDir } from './paths'
import { writeTextFileAtomic } from './docStore'

/** patch 中的 meta 可改字段；undefined = 不动该字段（update IPC 透传整 Chapter，缺 volumeId 视同不改）。 */
type MetaPatch = Partial<Pick<ChapterMeta, 'title' | 'volumeId' | 'status'>>

interface LoadedDoc {
  /** 文件名 stem（id 权威） */
  stem: string
  abs: string
  meta: ChapterMeta
  body: string
}

/** Task 9 域缓存：projectPath → 与磁盘一致的已排序列表（mutation 就地维护；invalidateCache 整域清空）。 */
const listCache = new Map<string, Chapter[]>()

/** 清空 chapters 域缓存（下次 listChapters 重读磁盘）——只治本域，不碰其他仓库（裁定 1）。 */
export function invalidateCache(p: string): void {
  listCache.delete(p)
}

export function listChapters(p: string): Chapter[] {
  const cached = listCache.get(p)
  if (cached) return [...cached] // 命中缓存：零 IO；浅拷贝防调用方排序/增删污染缓存本体
  const list = loadAll(p)
    .sort((a, b) => a.meta.order - b.meta.order || a.stem.localeCompare(b.stem))
    .map((d) => toChapter(d))
  listCache.set(p, list) // 惰性填充：只有 list 侧填缓存，mutation/get 不填（miss 时走磁盘）
  return [...list]
}

export function createChapter(p: string, title: string, volumeId?: string | null): Chapter {
  if (isInvalidTitle(title)) {
    throw new Error(`CHAPTER_TITLE_INVALID: ${title}`) // create 场景回显 title（此时尚无 id）
  }
  const docs = loadAll(p)
  const order = docs.reduce((max, d) => Math.max(max, d.meta.order), 0) + 1
  const meta: ChapterMeta = {
    id: randomUUID(),
    title,
    volumeId: volumeId ?? null, // ChapterMeta.volumeId 必填：显式 null，不许 undefined
    order,
    status: 'draft'
  }
  const body = `# ${title}\n\n` // 与 v1 手感一致
  const abs = chapterFile(p, meta.id)
  writeDoc(abs, meta, body)
  const chapter = toChapter({ stem: meta.id, abs, meta, body })
  // 先写盘、后就地更新缓存（裁定 1）：order = max+1 → 追加尾端即保持升序；未填充则不动（惰性）
  const cached = listCache.get(p)
  if (cached) cached.push(chapter)
  return chapter
}

/**
 * Task 5 接口裁定：content 可选。缺省 = meta-only 写（卷归属/状态变更不重排正文——
 * body 以磁盘字节为准原样回写，绝不重新「序列化」正文）；带 content 的行为与 Task 4 完全一致。
 */
export function updateChapter(
  p: string,
  id: string,
  patch: MetaPatch & { content?: string }
): Chapter {
  return applyPatch(p, id, patch)
}

export function renameChapter(p: string, id: string, newTitle: string): Chapter {
  // = updateChapter 的 title 别名（不带 content → 正文以磁盘为准，只按裁定做 H1 同步）
  return applyPatch(p, id, { title: newTitle })
}

export function deleteChapter(p: string, id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false // 幂等契约优先于 BAD_CHAPTER_ID 抛错（评审裁定）
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) return false // 幂等：缺失返回 false，不抛
  unlinkSync(abs)
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((c) => c.id === id)
    if (idx !== -1) cached.splice(idx, 1) // 就地同步：缓存 == 刚写定的磁盘状态
  }
  return true
}

/** 把 id 移到 toOrder 所在槽位（handler 的 fromId/toId → toId.order 映射后调用），order 重编稠密 1..n。 */
export function moveChapter(p: string, id: string, toOrder: number): boolean {
  assertChapterId(id)
  const docs = loadAll(p).sort((a, b) => a.meta.order - b.meta.order || a.stem.localeCompare(b.stem))
  const fromIdx = docs.findIndex((d) => d.stem === id)
  if (fromIdx === -1) return false

  const [moved] = docs.splice(fromIdx, 1)
  // 语义同 v1 splice(toIndex)：toOrder 为 1 基槽位；越界钳位到首/尾
  const insertAt = Math.max(0, Math.min(toOrder - 1, docs.length))
  docs.splice(insertAt, 0, moved)

  docs.forEach((d, i) => {
    const order = i + 1
    if (d.meta.order !== order) {
      // 受影响文件各重写一次 meta，正文原样（写回原路径 = 文件名不动）
      const meta = { ...d.meta, order }
      writeDoc(d.abs, meta, d.body)
    }
  })
  // 重排落盘后整条重建缓存条目（docs 此刻与磁盘逐一对应，order 按新位次）——就地同步（裁定 1）
  if (listCache.has(p)) {
    listCache.set(
      p,
      docs.map((d, i) => toChapter({ ...d, meta: { ...d.meta, order: i + 1 } }))
    )
  }
  return true
}

/**
 * 点读单章。缓存只短路「正命中」（裁定 1 的省 IO 面）；修订 ②：缓存缺席 ≠ 不存在——
 * 坏档被 list 侧 warn+跳过、外部直写漂移都会造成缓存缺 id，此时必须回落磁盘路径兑现点读契约：
 * 缺失 → null、坏档 → FRONTMATTER_* 抛穿（与无缓存时逐字一致）。
 * `bypassCache: true` = 无条件直读磁盘（修订 ① 冲突判定的输入：要的是此刻的磁盘真相，不是缓存权威）。
 */
export function getChapter(
  p: string,
  id: string,
  opts?: { bypassCache?: boolean }
): Chapter | null {
  assertChapterId(id)
  if (!opts?.bypassCache) {
    const cached = listCache.get(p)
    if (cached) {
      const hit = cached.find((c) => c.id === id)
      if (hit) return hit // 正命中：零 IO
    }
  }
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) return null
  const doc = parseChapterDoc(readFileSync(abs, 'utf8'), abs)
  return toChapter({ stem: id, abs, meta: doc.meta, body: doc.body })
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** id 形状门：文件名 = `<id>.md`，非 UUID（如 `../../evil`）会经 join 路径重定向越出章节目录——v1 遗留，边界封死。 */
function assertChapterId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`BAD_CHAPTER_ID: ${id}`)
  }
}

/** front-matter 要求 title 为非空单行串；空白/含换行一律先于任何写盘拒绝（列表侧否则解析跳过=章节隐身）。 */
function isInvalidTitle(title: string): boolean {
  return title.trim() === '' || /[\n\r]/.test(title)
}

/** 读-改-写单一入口：title 变化触发 H1 同步；content 缺省时正文以磁盘为准。 */
function applyPatch(p: string, id: string, patch: MetaPatch & { content?: string }): Chapter {
  assertChapterId(id)
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) {
    throw new Error(`CHAPTER_MISSING: ${id}`)
  }
  const parsed = parseChapterDoc(readFileSync(abs, 'utf8'), abs)
  const meta: ChapterMeta = { ...parsed.meta }
  let body = patch.content !== undefined ? patch.content : parsed.body

  // 与 H1 同步同一 `!== 存量` 条件：只校验「新设定/改变」的 title——handler 回显的存量坏形状
  // 标题原样放行（不静默改写教义），任何写盘之前抛错
  if (patch.title !== undefined && patch.title !== meta.title) {
    if (isInvalidTitle(patch.title)) {
      throw new Error(`CHAPTER_TITLE_INVALID: ${id}`)
    }
    body = syncFirstHeading(body, patch.title)
    meta.title = patch.title
  }
  if (patch.volumeId !== undefined) meta.volumeId = patch.volumeId
  if (patch.status !== undefined) meta.status = patch.status

  writeDoc(abs, meta, body)
  const updated = toChapter({ stem: id, abs, meta, body })
  // 先写盘、后就地更新缓存（裁定 1）：整元素替换（不共享对象突变——旧持有者保留自己的快照）。
  // 缓存有条目却缺本章 = 外部直写漂移（生产由 watcher 失效兜底）——补入并重排，维持「缓存==磁盘」不变量
  const cached = listCache.get(p)
  if (cached) {
    const idx = cached.findIndex((c) => c.id === id)
    if (idx !== -1) {
      cached[idx] = updated
    } else {
      cached.push(updated)
      cached.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    }
  }
  return updated
}

/**
 * 控制器裁定：title 变化时同步正文首行 H1（页内标题不与 tab/树分叉，镜像 v1 rename 行为）。
 * 只替换首条非空行且该行以 `# ` 开头的情形；其余字节（含 CRLF、后续空行）一律不动，
 * 行尾原有的 `\r` 保留；首非空行不是 H1 → 原样返回（不伪造 `# ` 行）。
 */
function syncFirstHeading(body: string, newTitle: string): string {
  const lines = body.split('\n')
  const idx = lines.findIndex((l) => l.trim() !== '')
  if (idx === -1) return body
  const line = lines[idx]
  if (!line.startsWith('# ')) return body
  lines[idx] = `# ${newTitle}${line.endsWith('\r') ? '\r' : ''}`
  return lines.join('\n')
}

function writeDoc(abs: string, meta: ChapterMeta, body: string): void {
  writeTextFileAtomic(abs, serializeChapterDoc(meta, body))
}

/** 列出目录全部 *.md 并解析；坏 front-matter 文件 console.warn 跳过（不抛）。 */
function loadAll(p: string): LoadedDoc[] {
  const dir = chaptersDir(p)
  if (!existsSync(dir)) return []
  const docs: LoadedDoc[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const abs = join(dir, name)
    try {
      const { meta, body } = parseChapterDoc(readFileSync(abs, 'utf8'), name)
      docs.push({ stem: name.slice(0, -'.md'.length), abs, meta, body })
    } catch (err) {
      console.warn(`跳过损坏章节文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return docs
}

function toChapter(d: LoadedDoc): Chapter {
  const stats = statSync(d.abs)
  return {
    id: d.stem,
    title: d.meta.title,
    content: d.body,
    volumeId: d.meta.volumeId,
    order: d.meta.order,
    status: d.meta.status,
    wordCount: countWords(d.body),
    createdAt: new Date(stats.ctime),
    updatedAt: new Date(stats.mtime)
  }
}

// v2 章节仓库（Task 4）：chapters/<uuid>.md = front-matter(meta) + 正文(body)。
// 主进程代码：相对导入 + node: 前缀。渲染层 Chapter.content 自此 = body（不含 front-matter），
// title/status/order/volumeId 全部来自 meta——v1 的「文件名当数据」字符串手术在此终结。
// 契约：
// - listChapters 单文件 parse 失败 console.warn + 跳过，绝不整体抛（一本坏章不让全书列表瘫痪）；
// - updateChapter/renameChapter 对缺失 id 抛 `CHAPTER_MISSING: <id>`（v1 静默写新文件的行为被禁）；
// - 文件名（stem）即 id 的唯一权威：update/rename 写回读到的同一路径，绝不改名；
// - moveChapter 重排后 order 重编为稠密 1..n（3.5 评审：碰撞场景靠稠密重编号扑灭）；
// - title 变化（update patch 带 title 或 rename）：body 首非空行以 `# ` 开头 → 只替换该行
//   （其余字节含 CRLF 原样），首非空行非 H1 → body 不动（不伪造 H1，title 只活在 front-matter）。
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Chapter } from '../../../src/common/ipc'
import type { ChapterMeta } from '../../../src/common/schema'
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

export function listChapters(p: string): Chapter[] {
  return loadAll(p)
    .sort((a, b) => a.meta.order - b.meta.order || a.stem.localeCompare(b.stem))
    .map((d) => toChapter(d))
}

export function createChapter(p: string, title: string, volumeId?: string | null): Chapter {
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
  return toChapter({ stem: meta.id, abs, meta, body })
}

export function updateChapter(
  p: string,
  id: string,
  patch: MetaPatch & { content: string }
): Chapter {
  return applyPatch(p, id, patch)
}

export function renameChapter(p: string, id: string, newTitle: string): Chapter {
  // = updateChapter 的 title 别名（不带 content → 正文以磁盘为准，只按裁定做 H1 同步）
  return applyPatch(p, id, { title: newTitle })
}

export function deleteChapter(p: string, id: string): boolean {
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) return false // 幂等：缺失返回 false，不抛
  unlinkSync(abs)
  return true
}

/** 把 id 移到 toOrder 所在槽位（handler 的 fromId/toId → toId.order 映射后调用），order 重编稠密 1..n。 */
export function moveChapter(p: string, id: string, toOrder: number): boolean {
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
  return true
}

export function getChapter(p: string, id: string): Chapter | null {
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) return null
  const doc = parseChapterDoc(readFileSync(abs, 'utf8'), abs)
  return toChapter({ stem: id, abs, meta: doc.meta, body: doc.body })
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 读-改-写单一入口：title 变化触发 H1 同步；content 缺省时正文以磁盘为准。 */
function applyPatch(p: string, id: string, patch: MetaPatch & { content?: string }): Chapter {
  const abs = chapterFile(p, id)
  if (!existsSync(abs)) {
    throw new Error(`CHAPTER_MISSING: ${id}`)
  }
  const parsed = parseChapterDoc(readFileSync(abs, 'utf8'), abs)
  const meta: ChapterMeta = { ...parsed.meta }
  let body = patch.content !== undefined ? patch.content : parsed.body

  if (patch.title !== undefined && patch.title !== meta.title) {
    body = syncFirstHeading(body, patch.title)
    meta.title = patch.title
  }
  if (patch.volumeId !== undefined) meta.volumeId = patch.volumeId
  if (patch.status !== undefined) meta.status = patch.status

  writeDoc(abs, meta, body)
  return toChapter({ stem: id, abs, meta, body })
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
      console.warn(`跳过损坏章节文件: ${name}: ${err instanceof Error ? err.message : String(err)}`)
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

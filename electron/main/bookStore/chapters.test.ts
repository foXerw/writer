// v2 章节仓库测试（Task 4）：tmp 书目录 + 真实文件系统，钉死 brief Step 1 全部行为——
// create→list 顺序；update 文件名不动 + front-matter 更新；move 后 order 稠密 1..n 无重复且正文不串；
// delete 幂等；损坏 front-matter 文件 list 时 console.warn + 跳过（绝不整体抛）；
// 以及控制器裁定：title 变化 → body 首（非空）行为 `# ` 开头则整行替换（其余字节含 CRLF 不动），
// 首非空行非 H1 → body 原样（不伪造 H1）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import {
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  moveChapter,
  renameChapter,
  updateChapter
} from './chapters'
import { chaptersDir } from './paths'
import { migrateBook } from './migrate'
import { parseChapterDoc, serializeChapterDoc } from '../../../src/common/chapterDoc'
import { UUID_PATTERN, type ChapterMeta } from '../../../src/common/schema'
import { countWords } from '../../../src/common/wordCount'
import type { Chapter } from '../../../src/common/ipc'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function rawOf(p: string, id: string): string {
  return readFileSync(join(chaptersDir(p), `${id}.md`), 'utf8')
}

// ---------------------------------------------------------------------------
// create + list
// ---------------------------------------------------------------------------

describe('createChapter + listChapters', () => {
  it('create 落盘 chapters/<uuid>.md；list 按 order 升序，content 不含 front-matter', () => {
    const p = mkTmpBook()
    const a = createChapter(p, '第一章')
    const b = createChapter(p, '第二章')

    expect(a.id).toMatch(UUID_PATTERN)
    expect(b.id).toMatch(UUID_PATTERN)
    expect(existsSync(join(chaptersDir(p), `${a.id}.md`))).toBe(true)

    // 文件本体 = front-matter + 正文（v1 手感：body 初始 `# 标题\n\n`）
    const raw = rawOf(p, a.id)
    expect(raw.startsWith('---\n')).toBe(true)
    expect(raw).toBe(serializeChapterDoc(
      { id: a.id, title: '第一章', volumeId: null, order: 1, status: 'draft' },
      '# 第一章\n\n'
    ))

    const list = listChapters(p)
    expect(list.map((c) => c.title)).toEqual(['第一章', '第二章'])
    expect(list.map((c) => c.order)).toEqual([1, 2])
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
    for (const c of list) {
      expect(c.content).not.toContain('---')
      expect(c.content).toBe(`# ${c.title}\n\n`)
      expect(c.wordCount).toBe(countWords(c.content))
      expect(c.status).toBe('draft')
      expect(c.volumeId).toBeNull()
      expect(c.createdAt).toBeInstanceOf(Date)
      expect(c.updatedAt).toBeInstanceOf(Date)
    }
  })

  it('createChapter 传 volumeId → front-matter 记录卷归属', () => {
    const p = mkTmpBook()
    const vol = '11111111-2222-4222-8222-222222222222'
    const c = createChapter(p, '挂靠章', vol)
    expect(c.volumeId).toBe(vol)
    expect(parseChapterDoc(rawOf(p, c.id), c.id).meta.volumeId).toBe(vol)
  })

  it('chapters 目录不存在 → listChapters 返回空数组', () => {
    const p = mkTmpBook()
    expect(listChapters(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// update（含 H1 同步裁定）
// ---------------------------------------------------------------------------

describe('updateChapter', () => {
  it('title 变化：文件名不动、front-matter 更新、body 首行 H1 同步替换', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '旧标题')
    const before = readdirSync(chaptersDir(p))

    const updated = updateChapter(p, c.id, {
      title: '新标题',
      content: '# 旧标题\n\n正文一段。\n'
    })

    expect(readdirSync(chaptersDir(p))).toEqual(before) // 文件名不动（无新建/残留 tmp）
    expect(updated.title).toBe('新标题')
    expect(updated.content).toBe('# 新标题\n\n正文一段。\n')
    expect(updated.wordCount).toBe(countWords(updated.content))

    const { meta, body } = parseChapterDoc(rawOf(p, c.id), c.id)
    expect(meta.title).toBe('新标题')
    expect(body).toBe('# 新标题\n\n正文一段。\n')
  })

  it('title 变化但 body 首非空行非 H1 → body 原样，绝不伪造 `# ` 行', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '旧标题')
    const updated = updateChapter(p, c.id, { title: '新标题', content: '没有标题行的正文。\n' })
    expect(updated.content).toBe('没有标题行的正文。\n')
    expect(parseChapterDoc(rawOf(p, c.id), c.id).body).toBe('没有标题行的正文。\n')
  })

  it('title 未变：content 原样落盘（编辑器里手改的 H1 不被回写覆盖）', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '标题')
    const updated = updateChapter(p, c.id, { title: '标题', content: '# 用户手改的行内标题\n正文\n' })
    expect(updated.content).toBe('# 用户手改的行内标题\n正文\n')
  })

  it('H1 同步保留其余字节（CRLF 行尾不被破坏）', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '旧')
    const updated = updateChapter(p, c.id, {
      title: '新',
      content: '# 旧\r\n\r\n第二行\r\n'
    })
    expect(updated.content).toBe('# 新\r\n\r\n第二行\r\n')
  })

  it('status 真实化：patch.status 写入 front-matter', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '章')
    const updated = updateChapter(p, c.id, { content: c.content, status: 'completed' })
    expect(updated.status).toBe('completed')
    expect(parseChapterDoc(rawOf(p, c.id), c.id).meta.status).toBe('completed')
  })

  it('update 不传 volumeId → 既有 volumeId 保持不变', () => {
    const p = mkTmpBook()
    const vol = '11111111-2222-4222-8222-222222222222'
    const c = createChapter(p, '章', vol)
    const updated = updateChapter(p, c.id, { content: '正文\n' })
    expect(updated.volumeId).toBe(vol)
  })

  it('id 不存在 → 抛 CHAPTER_MISSING: <id>（v1 静默写新文件的行为被禁）', () => {
    const p = mkTmpBook()
    const ghost = '99999999-8888-4888-8888-777777777777'
    expect(() => updateChapter(p, ghost, { content: 'x' })).toThrow(`CHAPTER_MISSING: ${ghost}`)
    expect(existsSync(join(chaptersDir(p), `${ghost}.md`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// rename（update 的 title 别名，钉死「rename syncs H1」）
// ---------------------------------------------------------------------------

describe('renameChapter', () => {
  it('rename = title 别名：front-matter 与 body 首行 H1 同步，其余行零改动', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '第一章 起风')
    updateChapter(p, c.id, { content: '# 第一章 起风\n\n风从海上来。\n\n尾注。\n' })

    const renamed = renameChapter(p, c.id, '第二章 落潮')
    expect(renamed.title).toBe('第二章 落潮')
    expect(renamed.content).toBe('# 第二章 落潮\n\n风从海上来。\n\n尾注。\n')
    expect(parseChapterDoc(rawOf(p, c.id), c.id).meta.title).toBe('第二章 落潮')
  })

  it('rename 正文无 H1 → body 原样（title 只活在 front-matter）', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '标题')
    updateChapter(p, c.id, { content: '纯正文。\n' })
    expect(renameChapter(p, c.id, '新题').content).toBe('纯正文。\n')
  })

  it('rename 不存在的 id → CHAPTER_MISSING', () => {
    const p = mkTmpBook()
    expect(() => renameChapter(p, 'nope', 'x')).toThrow('CHAPTER_MISSING: nope')
  })
})

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe('moveChapter', () => {
  it('移动末章到首位：order 稠密 1..n 无重复、列表顺序对、正文不串', () => {
    const p = mkTmpBook()
    const a = createChapter(p, '甲')
    const b = createChapter(p, '乙')
    const c = createChapter(p, '丙')

    expect(moveChapter(p, c.id, 1)).toBe(true)
    const list = listChapters(p)
    expect(list.map((x) => x.id)).toEqual([c.id, a.id, b.id])
    expect(list.map((x) => x.order)).toEqual([1, 2, 3])
    // 正文不串：每章 body 仍是自己的标题
    for (const x of list) {
      expect(x.content).toBe(`# ${x.title}\n\n`)
    }
    // 落盘 front-matter 无重复 order
    const orders = readdirSync(chaptersDir(p))
      .filter((f) => f.endsWith('.md'))
      .map((f) => parseChapterDoc(readFileSync(join(chaptersDir(p), f), 'utf8'), f).meta.order)
      .sort((x, y) => x - y)
    expect(orders).toEqual([1, 2, 3])
  })

  it('移到中间：插入语义同 v1（from 落到 to 所在 order 位）', () => {
    const p = mkTmpBook()
    const a = createChapter(p, '甲')
    createChapter(p, '乙')
    createChapter(p, '丙')

    expect(moveChapter(p, a.id, 3)).toBe(true) // a 移到丙(3) 的位置
    expect(listChapters(p).map((x) => x.title)).toEqual(['乙', '丙', '甲'])
    expect(listChapters(p).map((x) => x.order)).toEqual([1, 2, 3])
  })

  it('toOrder 越界 → 钳位到首/尾；不存在的 id → false', () => {
    const p = mkTmpBook()
    const a = createChapter(p, '甲')
    createChapter(p, '乙')
    expect(moveChapter(p, a.id, 99)).toBe(true)
    expect(listChapters(p).map((x) => x.id).indexOf(a.id)).toBe(1)
    expect(moveChapter(p, 'ghost', 1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// delete + get
// ---------------------------------------------------------------------------

describe('deleteChapter / getChapter', () => {
  it('delete 幂等：首次 true，重复 false，文件消失', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '删我')
    expect(deleteChapter(p, c.id)).toBe(true)
    expect(existsSync(join(chaptersDir(p), `${c.id}.md`))).toBe(false)
    expect(deleteChapter(p, c.id)).toBe(false)
  })

  it('getChapter：存在返回整章，不存在返回 null', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '独章')
    const got = getChapter(p, c.id) as Chapter
    expect(got.id).toBe(c.id)
    expect(got.content).toBe('# 独章\n\n')
    expect(getChapter(p, 'nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listChapters 容错
// ---------------------------------------------------------------------------

describe('listChapters 损坏文件容错', () => {
  it('单文件 front-matter 损坏 → console.warn + 跳过，不整体抛', () => {
    const p = mkTmpBook()
    const good = createChapter(p, '完好章')
    mkdirSync(chaptersDir(p), { recursive: true })
    writeFileSync(join(chaptersDir(p), 'broken.md'), '完全没有 front-matter 的旧文件\n', 'utf8')
    writeFileSync(join(chaptersDir(p), 'invalid.md'), '---\nid: 不是uuid\n---\n\n正文\n', 'utf8')

    const list = listChapters(p)
    expect(list.map((c) => c.id)).toEqual([good.id])
    expect(console.warn).toHaveBeenCalled()
  })

  it('meta.id 与文件名不一致的极端残档：以文件名为准（无 v1 split 手术）', () => {
    const p = mkTmpBook()
    mkdirSync(chaptersDir(p), { recursive: true })
    const meta: ChapterMeta = {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      title: '错位章',
      volumeId: null,
      order: 1,
      status: 'draft'
    }
    writeFileSync(
      join(chaptersDir(p), 'bbbbbbbb-2222-4222-8222-222222222222.md'),
      serializeChapterDoc(meta, '正文\n'),
      'utf8'
    )
    expect(listChapters(p)[0].id).toBe('bbbbbbbb-2222-4222-8222-222222222222')
  })
})

// ---------------------------------------------------------------------------
// 瞬态窗口关闭证明：v1 迁移 → v2 章节列表立即可用
// ---------------------------------------------------------------------------

describe('瞬态窗口关闭：migrateBook → listChapters', () => {
  it('迁移 v1 书后 listChapters 立刻返回有序章节且正文逐字节完整', () => {
    const p = mkTmpBook()
    const ch1Raw = '# 黎明\n\n第一段。\n\n第二段。\n'
    const ch2Raw = '没有标题行的正文。\n'
    mkdirSync(join(p, 'chapters'), { recursive: true })
    writeFileSync(
      join(p, '.novelwriter.json'),
      JSON.stringify({
        name: '星海',
        type: 'novel',
        settings: { wordCountGoal: 0, dailyGoal: 2000, autoSave: true, autoSaveInterval: 30000 }
      }),
      'utf8'
    )
    writeFileSync(join(p, 'chapters', '001-黎明.md'), ch1Raw, 'utf8')
    writeFileSync(join(p, 'chapters', '002-黄昏.md'), ch2Raw, 'utf8')

    migrateBook(p)

    const list = listChapters(p)
    expect(list.map((c) => c.order)).toEqual([1, 2])
    expect(list.map((c) => c.title)).toEqual(['黎明', '黄昏'])
    expect(list.map((c) => c.status)).toEqual(['draft', 'draft'])
    // 正文逐字节原样（含 v1 的 `# 标题` 首行——迁移不改 body 的承诺由列表侧兑现）
    expect(list.map((c) => c.content)).toEqual([ch1Raw, ch2Raw])
    expect(list[0].wordCount).toBe(countWords(ch1Raw))
    expect(list[0].volumeId).toBeNull()
  })

  it('迁移后的章节可直接 update/delete/move：写回同一 uuid 文件，无 v1 文件名残留', () => {
    const p = mkTmpBook()
    mkdirSync(join(p, 'chapters'), { recursive: true })
    writeFileSync(
      join(p, '.novelwriter.json'),
      JSON.stringify({ name: '星海', type: 'novel', settings: {} }),
      'utf8'
    )
    writeFileSync(join(p, 'chapters', '001-甲.md'), '# 甲\n\nA。\n', 'utf8')
    writeFileSync(join(p, 'chapters', '002-乙.md'), '# 乙\n\nB。\n', 'utf8')
    writeFileSync(join(p, 'chapters', '003-丙.md'), '# 丙\n\nC。\n', 'utf8')

    migrateBook(p)
    const list = listChapters(p)
    expect(list.every((c) => UUID_PATTERN.test(c.id))).toBe(true)

    const updated = updateChapter(p, list[0].id, { title: '甲改', content: list[0].content })
    expect(updated.content).toBe('# 甲改\n\nA。\n')
    expect(moveChapter(p, list[2].id, 1)).toBe(true)
    expect(deleteChapter(p, list[1].id)).toBe(true)
    expect(listChapters(p).map((c) => c.title)).toEqual(['丙', '甲改'])
    expect(readdirSync(chaptersDir(p)).filter((f) => /^\d+-/.test(f))).toEqual([])
  })
})

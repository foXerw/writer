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
  invalidateCache,
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

  it('meta-only patch（content 缺省）：front-matter 重写，body 字节原样不动（Task 5 接口裁定）', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '标题')
    updateChapter(p, c.id, { content: '# 标题\r\n\r\n带 CRLF 的正文。\r\n第二行\r\n' })
    const rawBefore = rawOf(p, c.id)
    const bodyBefore = parseChapterDoc(rawBefore, c.id).body

    const vol = '11111111-2222-4222-8222-222222222222'
    const updated = updateChapter(p, c.id, { volumeId: vol })
    expect(updated.volumeId).toBe(vol)
    const rawAfter = rawOf(p, c.id)
    expect(rawAfter).not.toBe(rawBefore) // front-matter 确实重写
    expect(rawAfter.endsWith(bodyBefore)).toBe(true) // body 逐字节 = 原后缀（不重新序列化正文）
    expect(parseChapterDoc(rawAfter, c.id).body).toBe(bodyBefore)
    expect(updated.content).toBe(bodyBefore)
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

  it('rename 不存在的（合法形状）id → CHAPTER_MISSING', () => {
    const p = mkTmpBook()
    const ghost = '99999999-8888-4888-8888-777777777777'
    expect(() => renameChapter(p, ghost, 'x')).toThrow(`CHAPTER_MISSING: ${ghost}`)
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
    expect(moveChapter(p, '99999999-8888-4888-8888-777777777777', 1)).toBe(false)
    expect(() => moveChapter(p, 'ghost', 1)).toThrow('BAD_CHAPTER_ID: ghost')
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
    expect(getChapter(p, '99999999-8888-4888-8888-777777777777')).toBeNull()
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
    // 跳过警告必须带绝对路径（裸文件名在多书并行时无法定位）
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(join(chaptersDir(p), 'broken.md')))
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
// 仓库边界守卫（评审整改：标题合法性 + id 形状）
// ---------------------------------------------------------------------------

describe('标题守卫 CHAPTER_TITLE_INVALID', () => {
  it('rename("") → 抛错且磁盘逐字节不动、章节仍可列出', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '标题')
    const rawBefore = rawOf(p, c.id)

    expect(() => renameChapter(p, c.id, '   ')).toThrow(`CHAPTER_TITLE_INVALID: ${c.id}`)
    expect(rawOf(p, c.id)).toBe(rawBefore)
    expect(listChapters(p).map((x) => x.id)).toEqual([c.id])
  })

  it('update{title:"a\\nb"} → 抛错且磁盘逐字节不动、章节仍可列出', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '标题')
    const rawBefore = rawOf(p, c.id)

    expect(() => updateChapter(p, c.id, { title: 'a\nb', content: 'x' })).toThrow(
      `CHAPTER_TITLE_INVALID: ${c.id}`
    )
    expect(rawOf(p, c.id)).toBe(rawBefore)
    expect(listChapters(p).map((x) => x.id)).toEqual([c.id])
  })

  it('createChapter 空白/含换行标题 → CHAPTER_TITLE_INVALID（回显 title）且零落盘', () => {
    const p = mkTmpBook()
    expect(() => createChapter(p, '  ')).toThrow('CHAPTER_TITLE_INVALID:   ')
    expect(() => createChapter(p, '甲\r\n乙')).toThrow('CHAPTER_TITLE_INVALID: 甲\r\n乙')
    expect(existsSync(chaptersDir(p))).toBe(false)
  })

  it('存量坏形状标题未变 → 照常 update 成功（守卫只拦「新设定/改变」的 title，不拦 handler 回显）', () => {
    const p = mkTmpBook()
    // 手造存量档：title 含换行（validateChapterMeta 只要求非空串 → front-matter 合法可解析）
    const bad = 'aaaaaaaa-1111-4111-8111-111111111111'
    mkdirSync(chaptersDir(p), { recursive: true })
    writeFileSync(
      join(chaptersDir(p), `${bad}.md`),
      serializeChapterDoc(
        { id: bad, title: '旧\n换行题', volumeId: null, order: 1, status: 'draft' },
        '# 旧\n换行题\n\n正文。\n'
      ),
      'utf8'
    )

    // title 原样回显（updateChapter 走 handler 同款 patch）→ 不抛、内容落盘、仍被列出
    const updated = updateChapter(p, bad, { title: '旧\n换行题', content: '新正文。\n' })
    expect(updated.content).toBe('新正文。\n')
    expect(updated.title).toBe('旧\n换行题')
    expect(listChapters(p).map((c) => c.id)).toEqual([bad])
  })
})

describe('id 形状守卫 BAD_CHAPTER_ID', () => {
  it('getChapter("../../evil") → 抛错（v1 遗留的 join 路径重定向被封死），FS 零触碰', () => {
    const p = mkTmpBook()
    createChapter(p, '正主')
    expect(() => getChapter(p, '../../evil')).toThrow('BAD_CHAPTER_ID: ../../evil')
    expect(existsSync(join(p, '..', 'evil.md'))).toBe(false)
  })

  it('update/rename/move 非 UUID id 一律抛；delete 按幂等契约返回 false', () => {
    const p = mkTmpBook()
    expect(() => updateChapter(p, '../x', { content: 'x' })).toThrow('BAD_CHAPTER_ID: ../x')
    expect(() => renameChapter(p, 'nope', 'x')).toThrow('BAD_CHAPTER_ID: nope')
    expect(deleteChapter(p, '../evil')).toBe(false)
    expect(existsSync(join(p, '..', 'evil.md'))).toBe(false)
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

// ---------------------------------------------------------------------------
// Task 9 域缓存语义（裁定 1 的唯一钉死点——其余四仓库镜像同一契约，不重复铺测试）
// ---------------------------------------------------------------------------

describe('缓存语义（list/get 命中缓存、mutation 就地同步、invalidateCache 分域清空）', () => {
  it('(a) list → updateChapter → list 立即见新内容（mutation 先写盘后就地更新缓存，无需 invalidate）', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '甲章')
    expect(listChapters(p)[0].content).toBe('# 甲章\n\n') // 首次访问：读盘并填充缓存

    updateChapter(p, c.id, { content: '新正文。\n' }) // mutation：原子写盘 → 缓存就地同步

    // 缓存命中也必须 == 磁盘真相（裁定 1 字节级契约：缓存条目 = 刚写盘的内容）
    expect(listChapters(p)[0].content).toBe('新正文。\n')
    expect(getChapter(p, c.id)?.content).toBe('新正文。\n') // getX 与 listX 同一缓存权威
    expect(parseChapterDoc(rawOf(p, c.id), c.id).body).toBe('新正文。\n')
  })

  it('(b) list → 绕过仓库直写磁盘 → list 仍显旧值（缓存权威）→ invalidateCache → list 见新值', () => {
    const p = mkTmpBook()
    const c = createChapter(p, '乙章')
    expect(listChapters(p)[0].title).toBe('乙章') // 填充缓存

    // 绕过仓库直写磁盘（模拟外部编辑器；生产环境由 watcher 失效兜底，测试里手动 invalidate）
    writeFileSync(
      join(chaptersDir(p), `${c.id}.md`),
      serializeChapterDoc(
        { id: c.id, title: '外部改写', volumeId: null, order: 1, status: 'draft' },
        '外部正文。\n'
      ),
      'utf8'
    )

    expect(listChapters(p)[0].title).toBe('乙章') // 缓存权威：直写不被感知（接受的陈旧窗口）
    invalidateCache(p) // 分域清空（只治 chapters 域）
    expect(listChapters(p)[0].title).toBe('外部改写') // 重读磁盘
    expect(listChapters(p)[0].content).toBe('外部正文。\n')
  })

  it('create/delete/move 全部就地同步缓存：mutation 之后 list 即磁盘状态', () => {
    const p = mkTmpBook()
    expect(listChapters(p)).toEqual([]) // 空目录也填充（[] 也是缓存条目——空书同样单次 IO）

    const a = createChapter(p, '甲')
    const b = createChapter(p, '乙')
    expect(listChapters(p).map((c) => c.title)).toEqual(['甲', '乙']) // create 追加尾端（order=max+1）

    expect(moveChapter(p, b.id, 1)).toBe(true)
    expect(listChapters(p).map((c) => c.title)).toEqual(['乙', '甲']) // move 重排后整条重建
    expect(listChapters(p).map((c) => c.order)).toEqual([1, 2])

    expect(deleteChapter(p, a.id)).toBe(true)
    expect(listChapters(p).map((c) => c.id)).toEqual([b.id]) // delete 就地摘除
    expect(getChapter(p, a.id)).toBeNull() // getX 同源：缓存里已无 a
  })
})

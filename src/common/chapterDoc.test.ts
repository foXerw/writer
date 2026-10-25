import { describe, it, expect } from 'vitest'
import { parseChapterDoc, serializeChapterDoc } from './chapterDoc'
import type { ChapterMeta } from './schema'

// Review Focus 4 钉在此：中文/特殊字符标题（#、/、emoji）与任意正文必须无损 round-trip。
const META: ChapterMeta = {
  id: '2b7c4f1e-9a3d-4e5f-8b6c-1a2b3c4d5e6f',
  title: '第三章 #决战/黎明🌅 — 终章',
  volumeId: null,
  order: 7,
  status: 'draft'
}

// 手写的最小合法 front-matter（不依赖 serialize，独立钉 parse 的宽容度契约）
const MINIMAL_RAW = [
  '---',
  'id: 2b7c4f1e-9a3d-4e5f-8b6c-1a2b3c4d5e6f',
  'title: 第一章',
  'volumeId: null',
  'order: 1',
  'status: draft',
  '---'
].join('\n')

describe('serializeChapterDoc + parseChapterDoc round-trip', () => {
  it('中文标题含 #、/、emoji，多段含空行正文完整回读', () => {
    const body = '第一段中文。\n\n第二段带行尾空格   \n\n\n第四段前有多余空行\n'

    const doc = parseChapterDoc(serializeChapterDoc(META, body))

    expect(doc.meta).toEqual(META)
    expect(doc.body).toBe(body)
  })

  it('body 中部的 --- 分隔线不被误判为 front-matter 闭合（只认起始第一个分隔块）', () => {
    const body = '正文开始\n\n---\n\n正文中段水平线之后\n---\n尾声'

    const doc = parseChapterDoc(serializeChapterDoc(META, body))

    expect(doc.meta).toEqual(META)
    expect(doc.body).toBe(body)
  })

  it('body 以 --- 开头也能无损回读（闭合定界后必跟空行，不会歧义）', () => {
    const body = '---\n危险开头'

    const doc = parseChapterDoc(serializeChapterDoc(META, body))

    expect(doc.body).toBe(body)
  })

  it('空 body round-trip', () => {
    const doc = parseChapterDoc(serializeChapterDoc(META, ''))

    expect(doc.meta).toEqual(META)
    expect(doc.body).toBe('')
  })

  it('序列化结构钉死：---\\n<yaml>\\n---\\n\\n<body>', () => {
    const raw = serializeChapterDoc(META, '正文内容')

    expect(raw.startsWith('---\n')).toBe(true)
    expect(raw).toContain('\n---\n\n正文内容')
    expect(raw).toContain('title:')
  })

  it('标题以 # 开头、超过 lineWidth:120 的长标题（触发 YAML 引号/折行）也无损回读', () => {
    const metas: ChapterMeta[] = [
      { ...META, title: '#1 开局即决战' },
      { ...META, title: '超长标题'.repeat(60) + '🌅/尾部' }
    ]
    for (const meta of metas) {
      const doc = parseChapterDoc(serializeChapterDoc(meta, '正文'))
      expect(doc.meta.title).toBe(meta.title)
      expect(doc.body).toBe('正文')
    }
  })

  it('volumeId 为字符串时同样 round-trip', () => {
    const meta: ChapterMeta = { ...META, volumeId: '3c8d5e2f-0b4e-4f6a-9c7d-2b3c4d5e6f70' }

    const doc = parseChapterDoc(serializeChapterDoc(meta, 'x'))

    expect(doc.meta).toEqual(meta)
  })
})

describe('parseChapterDoc 闭合定界后的换行宽容度（\\n\\n / \\n / EOF）', () => {
  it('闭合 --- 后直接 EOF：body 为空', () => {
    expect(parseChapterDoc(MINIMAL_RAW).body).toBe('')
  })

  it('闭合 --- 后单个 \\n：body 为空', () => {
    expect(parseChapterDoc(`${MINIMAL_RAW}\n`).body).toBe('')
  })

  it('闭合 --- 后 \\n\\n：body 为空', () => {
    expect(parseChapterDoc(`${MINIMAL_RAW}\n\n`).body).toBe('')
  })

  it('闭合 --- 后 \\n正文 与 \\n\\n正文：均解析出同一 body（一个 \\n 归一化）', () => {
    expect(parseChapterDoc(`${MINIMAL_RAW}\n正文`).body).toBe('正文')
    expect(parseChapterDoc(`${MINIMAL_RAW}\n\n正文`).body).toBe('正文')
  })

  it('body 自带的前导空行在归一化后仍保留', () => {
    expect(parseChapterDoc(`${MINIMAL_RAW}\n\n\n正文`).body).toBe('\n正文')
  })
})

describe('parseChapterDoc 错误契约', () => {
  it('无 front-matter 抛 FRONTMATTER_MISSING: <source>', () => {
    expect(() => parseChapterDoc('# 只有正文\n\n没有 front-matter', 'ch1')).toThrow(
      'FRONTMATTER_MISSING: ch1'
    )
  })

  it('空字符串抛 FRONTMATTER_MISSING: <source>', () => {
    expect(() => parseChapterDoc('', 'p.md')).toThrow('FRONTMATTER_MISSING: p.md')
  })

  it('有起始定界但无闭合定界抛 FRONTMATTER_MISSING: <source>', () => {
    expect(() => parseChapterDoc('---\nid: x\n没有闭合', 'p.md')).toThrow(
      'FRONTMATTER_MISSING: p.md'
    )
  })

  it('front-matter YAML 不可解析抛 FRONTMATTER_INVALID: <source>', () => {
    expect(() => parseChapterDoc('---\n[bad yaml,,,\n---\n\n正文', 'p.md')).toThrow(
      'FRONTMATTER_INVALID: p.md'
    )
  })

  it('meta 缺必备字段抛 FRONTMATTER_INVALID 且错误串含字段名', () => {
    expect(() => parseChapterDoc('---\ntitle: 无id\n---\n\n正文', 'p.md')).toThrow(
      /FRONTMATTER_INVALID: p\.md.*id/
    )
  })

  it('未传 source 时错误串用占位 source（不抛裸 undefined）', () => {
    expect(() => parseChapterDoc('纯正文')).toThrow(/FRONTMATTER_MISSING: .+/)
  })
})

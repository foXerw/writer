import type { Chapter } from '../../common/ipc'

export interface AssembleOptions {
  projectName: string
  chapters: Chapter[]      // 已过滤、已按 order 排序
  addFrontMatter: boolean
  addToc: boolean
  date: string             // 'YYYY-MM-DD'，由调用方传入（保持函数纯净）
}

// 标题 → 锚点 slug：小写、空白/标点→连字符、去首尾连字符。
// CJK 标题基本保留原字，目录链接在不同渲染器里可能不完全跳转，
// 但目录本身仍是可读章节列表（本批接受）。
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s/\\#:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 项目名 → 安全文件名：替换非法路径字符；空名兜底「导出」。
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || '导出'
}

// 把若干章节拼装为单个 Markdown 字符串（可选 YAML 前言 + 目录）。
export function assembleMarkdown(opts: AssembleOptions): string {
  const { projectName, chapters, addFrontMatter, addToc, date } = opts
  const parts: string[] = []

  if (addFrontMatter) {
    parts.push(`---\ntitle: ${projectName}\ndate: ${date}\nchapters: ${chapters.length}\n---\n`)
  }

  if (addToc) {
    const tocLines = chapters.map(c => `- [${c.title || '无标题'}](#${slugify(c.title || '无标题')})`)
    parts.push(`## 目录\n\n${tocLines.join('\n')}\n\n---\n`)
  }

  // 各章 content 本身已以 `# 标题` 开头（见 chapter:create/rename），直接拼接
  parts.push(chapters.map(c => c.content).join('\n\n'))

  return parts.join('\n')
}

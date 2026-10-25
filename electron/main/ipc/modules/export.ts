import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as url from 'url'
import { ExportParams } from '../../../../src/common/ipc'

// ==================== 文档导出（word/pdf/epub） ====================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 去掉首行 `# 标题`（标题单独传，避免重复）
function stripLeadingTitle(content: string): string {
  const lines = content.split('\n')
  if (lines.length && /^#{1,3}\s+/.test(lines[0])) {
    return lines.slice(1).join('\n').replace(/^\n+/, '')
  }
  return content
}

// 极简 md→html：按空行分段 <p>；识别 #/##/### 子标题；段内换行 <br/>
function markdownToHtml(md: string): string {
  return stripLeadingTitle(md)
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(block => {
      const h = block.match(/^(#{1,3})\s+(.*)$/)
      if (h) return `<h${h[1].length}>${escapeHtml(h[2])}</h${h[1].length}>`
      return `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')
}

function buildPdfHtml(projectName: string, chapters: { title: string; content: string }[], options: { addFrontMatter?: boolean; addToc?: boolean }): string {
  const toc = options.addToc
    ? `<nav><h2>目录</h2><ul>${chapters.map((c, i) => `<li>${i + 1}. ${escapeHtml(c.title)}</li>`).join('')}</ul></nav>`
    : ''
  const front = options.addFrontMatter ? `<h1 class="title">${escapeHtml(projectName)}</h1>` : ''
  const body = chapters.map(c => `<h1>${escapeHtml(c.title)}</h1>${markdownToHtml(c.content)}`).join('\n')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 2cm; }
body { font-family: "Microsoft YaHei","PingFang SC","Noto Sans CJK SC","SimSun",sans-serif; line-height: 1.8; font-size: 12pt; color:#000; }
h1 { font-size: 18pt; margin-top: 1.5em; page-break-after: avoid; }
h2,h3 { page-break-after: avoid; }
h1.title { text-align: center; font-size: 24pt; margin-top: 30%; }
p { text-indent: 2em; margin: 0 0 0.5em; }
nav { page-break-after: always; }
nav ul { list-style: none; padding-left: 0; }
</style></head><body>${front}${toc}${body}</body></html>`
}

export function registerExportHandlers(): void {
  ipcMain.handle('export:word', async (_, p: ExportParams): Promise<boolean> => {
    try {
      const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
      const children: unknown[] = []
      if (p.options.addFrontMatter) children.push(new Paragraph({ text: p.projectName, heading: HeadingLevel.TITLE }))
      if (p.options.addToc) p.chapters.forEach((c: { title: string; content: string }, i: number) => children.push(new Paragraph(`${i + 1}. ${c.title}`)))
      for (const c of p.chapters) {
        children.push(new Paragraph({ text: c.title, heading: HeadingLevel.HEADING_1 }))
        for (const block of stripLeadingTitle(c.content).split(/\n{2,}/)) {
          const t = block.trim()
          if (t) children.push(new Paragraph(t))
        }
      }
      const buf = await Packer.toBuffer(new Document({ sections: [{ children: children as never }] }))
      fs.writeFileSync(p.savePath, buf)
      return true
    } catch (e) {
      console.error('export:word 失败:', e)
      return false
    }
  })

  ipcMain.handle('export:epub', async (_, p: ExportParams): Promise<boolean> => {
    try {
      // epub-gen-memory 的 default export 是函数 (options, content) => Promise<Buffer>，而非 class；无 .gen()
      const epubGen = (await import('epub-gen-memory')).default
      const buf: Buffer = await epubGen(
        { title: p.projectName },
        p.chapters.map((c: { title: string; content: string }) => ({ title: c.title, content: markdownToHtml(c.content) }))
      )
      fs.writeFileSync(p.savePath, buf)
      return true
    } catch (e) {
      console.error('export:epub 失败:', e)
      return false
    }
  })

  ipcMain.handle('export:pdf', async (_, p: ExportParams): Promise<boolean> => {
    const html = buildPdfHtml(p.projectName, p.chapters, p.options)
    const tmp = path.join(os.tmpdir(), `novelwriter-export-${Date.now()}.html`)
    let win: BrowserWindow | null = null
    try {
      fs.writeFileSync(tmp, html, 'utf-8')
      win = new BrowserWindow({ show: false })
      await win.loadURL(url.pathToFileURL(tmp).toString())
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      fs.writeFileSync(p.savePath, pdf)
      return true
    } catch (e) {
      console.error('export:pdf 失败:', e)
      return false
    } finally {
      if (win) win.destroy()
      try { fs.unlinkSync(tmp) } catch { /* 临时文件清理忽略 */ }
    }
  })
}

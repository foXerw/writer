# 批次 5 设计：导出 Word / PDF / ePub（Export Formats）

> 日期: 2026-08-03
> 范围: 在现有 Markdown 导出基础上，新增 Word(.docx)/PDF/ePub 三种真实导出
> 依据: 批次2（导出 Markdown）扩展；ExportDialog 已留位（word/pdf/epub disabled「即将支持」）
> 关联: 4 批审计整改 + 收尾打磨 + lint 全清 + stats 清理已合并 main；本批为新增功能（非审计整改）

---

## 目标

端到端可用的 Word/PDF/ePub 导出。生成在**主进程**（`docx`、`epub-gen-memory` 为 Node 库；PDF 用 Electron 内置 `printToPDF`）。renderer 复用批次2 的 Markdown 管线前半段（flush→读→选章→空守卫），后段按格式分支。ExportDialog 启用三种格式。

## 架构与文件

| 文件 | 改动 |
|------|------|
| `package.json` | 加 `docx` + `epub-gen-memory` |
| `electron/main/ipc/handlers.ts` | 新增 `export:word` / `export:pdf` / `export:epub` 三个 handler + `markdownToHtml`/`stripLeadingTitle`/`escapeHtml`/`buildPdfHtml` 工具 |
| `src/renderer/services/ipcService.ts` | 新增 `exportDocument(format, params)` |
| `src/renderer/pages/Workspace/index.tsx` | `handleExport` 按格式分支；格式专属保存框扩展名/过滤器 |
| `src/renderer/components/Dialogs/ExportDialog.tsx` | 启用 word/pdf/epub（去 disabled、改描述） |

**新依赖 2 个**：`docx`（Word）、`epub-gen-memory`（ePub，`epub-gen` 的内存维护分支）。PDF 不引库（Electron printToPDF）。

## 数据流

`handleExport(options)`（renderer）：
1. `await saveCurrentChapter({silent:true})` → flush 当前章。
2. `await getAllChapters(projectPath)` → 排序 → 按范围选章 → 空守卫（同批次2）。
3. 按格式选扩展名 + 过滤器：word→`.docx`/`[{Word,['docx']}]`，pdf→`.pdf`/`[{PDF,['pdf']}]`，epub→`.epub`/`[{ePub,['epub']}]`，markdown→`.md`/`[{Markdown,['md']}]`。
4. `saveFileDialog(defaultName, filters)` → 取消则 `{ok:false}`。
5. 分支：
   - markdown：`assembleMarkdown(...)` → `writeFile` → ok（同批次2）。
   - word/pdf/epub：`exportDocument(format, { chapters: selected, projectName, options: options.options, savePath })` → 主进程生成写盘 → 返回 boolean。
6. ok → `message.success('导出成功')`+`{ok:true}`；失败 → `message.error('导出失败')`+`{ok:false}`。仅 ok 时关弹窗（批次2 的契约）。

---

## 主进程生成器（handlers.ts，均 `async`，动态 `import` 懒加载）

### 共享工具

```ts
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
```

### `export:word`（docx）

```ts
ipcMain.handle('export:word', async (_, p: ExportParams) => {
  const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
  const children: InstanceType<typeof Paragraph>[] = []
  if (p.options.addFrontMatter) children.push(new Paragraph({ text: p.projectName, heading: HeadingLevel.TITLE }))
  if (p.options.addToc) p.chapters.forEach((c, i) => children.push(new Paragraph(`${i + 1}. ${c.title}`)))
  for (const c of p.chapters) {
    children.push(new Paragraph({ text: c.title, heading: HeadingLevel.HEADING_1 }))
    for (const block of stripLeadingTitle(c.content).split(/\n{2,}/)) {
      const t = block.trim()
      if (t) children.push(new Paragraph(t))
    }
  }
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: children as any }] }))
  fs.writeFileSync(p.savePath, buf)
  return true
})
```

### `export:epub`（epub-gen-memory）

```ts
ipcMain.handle('export:epub', async (_, p: ExportParams) => {
  const EPub = (await import('epub-gen-memory')).default
  const epub = await new EPub({
    title: p.projectName,
    chapters: p.chapters.map(c => ({ title: c.title, content: markdownToHtml(c.content) }))
  })
  const buf: Buffer = await (epub as any).gen()
  fs.writeFileSync(p.savePath, buf)
  return true
})
```
> epub-gen-memory 自动由 chapters 生成 TOC。API 细节（`new EPub(opts).gen(): Promise<Buffer>`）以所装版本为准；必要时局部 `as any`。

### `export:pdf`（Electron printToPDF，临时 HTML 文件）

```ts
ipcMain.handle('export:pdf', async (_, p: ExportParams) => {
  const html = buildPdfHtml(p.projectName, p.chapters, p.options)
  const tmp = path.join(os.tmpdir(), `novelwriter-${Date.now()}.html`)
  fs.writeFileSync(tmp, html, 'utf-8')
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } as any })
  try {
    await win.loadURL(url.pathToFileURL(tmp).toString())
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(p.savePath, pdf)
    return true
  } finally {
    win.destroy()
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})
```

`buildPdfHtml`：A4、CJK 字体栈、章节 H1 + 分段 `<p>`（首行缩进）、`addFrontMatter` 加居中标题、`addToc` 加目录页（`page-break-after:always`）。

> `BrowserWindow`/`os`/`url` 已在 handlers.ts 可用（BrowserWindow 已 import；os/url 按需 import）。`Date.now()` 仅用于临时文件命名（主进程 app 代码，可用）。

### `ExportParams` 类型（handler 局部）

```ts
interface ExportParams {
  chapters: { title: string; content: string }[]
  projectName: string
  options: { addFrontMatter?: boolean; addToc?: boolean }
  savePath: string
}
```

---

## `ipcService.ts`

```ts
export type ExportFormat = 'word' | 'pdf' | 'epub'
export async function exportDocument(
  format: ExportFormat,
  params: { chapters: Chapter[]; projectName: string; options: { addFrontMatter?: boolean; addToc?: boolean }; savePath: string }
): Promise<boolean> {
  return invoke<boolean>(`export:${format}`, params)
}
```

## Workspace `handleExport` 分支

按格式选 `{ ext, filter }`：word→`docx`/`{name:'Word',extensions:['docx']}`，pdf→`pdf`/`{name:'PDF',extensions:['pdf']}`，epub→`epub`/`{name:'ePub',extensions:['epub']}`，markdown→`md`/`{name:'Markdown',extensions:['md']}`。`saveFileDialog` 后分支：markdown 走 `assembleMarkdown`+`writeFile`；其余走 `exportDocument`。返回 `{ok}`，仅 ok 关弹窗。

## ExportDialog 启用

`formatOptions`：word/pdf/epub 的 `disabled: false`、描述改为实际（如「可编辑 Word 文档」「便携式文档」「电子书阅读器格式」）。

---

## 边界与取舍

- **前言/目录**：epub 内置 TOC；word/pdf 的「生成目录」=简单章节标题列表（word 段落 / pdf 目录页），「前言」=标题行/居中标题。不实现 Word 原生 TOC 域。
- **大文件**：PDF 用临时 HTML 文件（非 data: URL，无大小限制），支持长篇。
- **章节内容**：统一 `stripLeadingTitle` 去首行标题（标题单独传）。
- **CJK 字体**：PDF HTML 用 CJK 字体栈（微软雅黑/苹方/Noto CJK），由 Blink 渲染。
- **生成失败**：handler try/catch 返回 false（`console.error`），renderer 报「导出失败」。
- **依赖类型**：`docx`/`epub-gen-memory` 自带类型；主进程局部 `as any` 兜底 API 差异（运行时不影响）。
- **懒加载**：`await import('docx'/'epub-gen-memory')` 动态加载，避免常驻内存。

## 范围外（明确不做）

- 「每章一个文件」导出；导入功能；Word 原生目录域/复杂样式；ePub 封面图/元数据编辑；PDF 页眉页脚/页码。

## 测试与验证（无测试框架）

- `npx tsc --noEmit`：被改文件不引入新错误（docx/epub-gen-memory 自带类型；主进程 `as any` 兜底）。
- `npm run build`：通过（含 electron main 构建）。
- `npm run lint`：保持 0/0（新代码注意未用变量/any 用 disable）。
- 手动冒烟（`npm run dev`，建 3 章带中文内容的项目）：
  1. 导出 Word → `.docx`：用 Word 打开，章节标题 + 正文段落正确，中文无乱码。
  2. 导出 PDF → `.pdf`：用 PDF 阅读器打开，A4、CJK、章节分段、（可选）目录页/标题正确。
  3. 导出 ePub → `.epub`：用 Calibre/阅读器打开，章节 + 内置 TOC 正确。
  4. 取消保存框 → 静默无错误；导出失败 → 报错。
  5. 回归：Markdown 导出仍正常；ExportDialog 四项均可选。

## 涉及文件清单

改 4 个源文件（handlers.ts、ipcService.ts、Workspace、ExportDialog）+ package.json。预计净增约 150–200 行（主进程为主）。

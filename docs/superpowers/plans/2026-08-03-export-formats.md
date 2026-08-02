# 批次 5 实现计划：导出 Word / PDF / ePub

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 新增 Word(.docx)/PDF/ePub 真实导出（主进程生成：docx / epub-gen-memory / Electron printToPDF）。

**Architecture:** renderer 复用批次2 管线（flush→读→选章→空守卫），按格式分支：markdown 走 assembleMarkdown+writeFile；word/pdf/epub 走 `exportDocument`→主进程 `export:<format>` IPC 生成写盘。ExportDialog 启用三格式。

**Tech Stack:** Electron + React 18 + TS + antd。无测试框架。新依赖 `docx` + `epub-gen-memory`。

## Global Constraints

- **无单元测试框架**：每任务验证 = `npx tsc --noEmit`（被改文件不引入新错误，基线约 31）+ `npm run build`（含 electron main 构建）+ `npm run lint`（保持 0/0）。子代理无法驱动 Electron GUI；手动冒烟由人完成。
- **新依赖**：`docx`、`epub-gen-memory`（PDF 用 Electron 内置 printToPDF，不引库）。若安装遇 peer 冲突，锁兼容版本。
- **分支**：`feat/export-formats`（已创建，spec 提交于 `6e1bd1a`）。
- 提交规范：Conventional Commits，中文，末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。

## 文件结构

| 文件 | 责任 | 任务 |
|------|------|------|
| `package.json` | 加 docx + epub-gen-memory | Task 1 |
| `src/common/ipc.ts` | 加 `ExportParams` 类型 | Task 1 |
| `src/renderer/services/ipcService.ts` | 加 `exportDocument` | Task 1 |
| `electron/main/ipc/handlers.ts` | 3 个生成 handler + 工具函数 | Task 2 |
| `src/renderer/components/Dialogs/ExportDialog.tsx` | 启用 word/pdf/epub | Task 3 |
| `src/renderer/pages/Workspace/index.tsx` | `handleExport` 按格式分支 | Task 4 |
| `docs/AUDIT.md` / `README.md` / `docs/DEVELOPMENT.md` | 阶段17 全完成 | Task 5 |

---

## Task 1: 依赖 + ExportParams 类型 + ipcService.exportDocument

**Files:**
- Modify: `package.json`（+`package-lock.json`）
- Modify: `src/common/ipc.ts`
- Modify: `src/renderer/services/ipcService.ts`

- [ ] **Step 1: 安装依赖**

Run: `npm install docx epub-gen-memory`
Expected: 安装成功（package.json devDeps 或 deps 加入两项；package-lock 更新）。若 peer 冲突，锁兼容版本（如 `epub-gen-memory@latest`、`docx@latest`）。

- [ ] **Step 2: common/ipc.ts 加 ExportParams**

在 `StatsData` 之后追加：
```ts
// 导出参数（word/pdf/epub 主进程生成用）
export interface ExportParams {
  chapters: { title: string; content: string }[]
  projectName: string
  options: { addFrontMatter?: boolean; addToc?: boolean }
  savePath: string
}
```

- [ ] **Step 3: ipcService.ts 加 exportDocument**

顶部既有 import 行 `import type { Chapter, ProjectData, RecentProject, FileFilter, StatsData } from '../common/ipc'` 扩展加 `ExportParams`：
```ts
import type { Chapter, ProjectData, RecentProject, FileFilter, StatsData, ExportParams } from '../common/ipc'
```
在「写作统计相关」之后追加：
```ts
// ==================== 文档导出相关 ====================

export type ExportFormat = 'word' | 'pdf' | 'epub'

export async function exportDocument(format: ExportFormat, params: ExportParams): Promise<boolean> {
  return invoke<boolean>(`export:${format}`, params)
}
```

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit 2>&1 | grep -E "common/ipc|ipcService"`（仅既有 `../common/ipc` TS2307，无新增）；`npm run build`（通过）。

- [ ] **Step 5: 提交**
```bash
git add package.json package-lock.json src/common/ipc.ts src/renderer/services/ipcService.ts
git commit -m "$(cat <<'EOF'
feat(export): 加 docx/epub-gen-memory 依赖 + ExportParams 类型 + exportDocument 封装

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 主进程三格式生成 handler

**Files:** Modify `electron/main/ipc/handlers.ts`

> 顶部既有 `import { dialog, ipcMain, BrowserWindow } from 'electron'`、`import * as fs from 'fs'`、`import * as path from 'path'`、`import { Chapter, ProjectType, Character, Setting, StatsData } from '../../src/common/ipc'`。需新增 `import * as os from 'os'`、`import * as url from 'url'`，并把 `ExportParams` 加入 common/ipc import。

- [ ] **Step 1: 补 import**

第 1-5 行区域：
```ts
import { dialog, ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as url from 'url'
import { randomUUID } from 'crypto'
import { Chapter, ProjectType, Character, Setting, StatsData, ExportParams } from '../../src/common/ipc'
```

- [ ] **Step 2: 文件末尾追加共享工具 + 三个 handler**

```ts
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

function buildPdfHtml(projectName: string, chapters: ExportParams['chapters'], options: ExportParams['options']): string {
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

ipcMain.handle('export:word', async (_, p: ExportParams): Promise<boolean> => {
  try {
    const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
    const children: unknown[] = []
    if (p.options.addFrontMatter) children.push(new Paragraph({ text: p.projectName, heading: HeadingLevel.TITLE }))
    if (p.options.addToc) p.chapters.forEach((c, i) => children.push(new Paragraph(`${i + 1}. ${c.title}`)))
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
    const EPub = (await import('epub-gen-memory')).default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const epub: any = await new EPub({
      title: p.projectName,
      chapters: p.chapters.map(c => ({ title: c.title, content: markdownToHtml(c.content) }))
    })
    const buf: Buffer = await epub.gen()
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
```

> `epub.gen()` 的确切返回类型依版本而定，用局部 `any` 兜底 + eslint-disable。docx `children as never` 绕过库内部类型。`Date.now()` 仅用于临时文件命名（主进程 app 代码，可用）。

- [ ] **Step 3: 验证**

Run: `npm run build`（含 electron main 构建，须通过——确认 docx/epub-gen-memory 能被打包）；`npx tsc --noEmit 2>&1 | grep handlers`（既有 `../../src/common/ipc` TS2307 等保留，无新增）；`npm run lint`（保持 0/0；新代码 any 已 disable）。

- [ ] **Step 4: 提交**
```bash
git add electron/main/ipc/handlers.ts
git commit -m "$(cat <<'EOF'
feat(export): 主进程新增 word/pdf/epub 生成 handler

docx 生成 Word；epub-gen-memory 生成 ePub（内置 TOC）；
Electron printToPDF 经临时 HTML 文件生成 PDF（CJK 字体栈，支持长篇）。
共享 markdownToHtml/stripLeadingTitle/escapeHtml/buildPdfHtml 工具。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

> 手动冒烟需 Task 4 接线后才能端到端；此处仅验证构建。

---

## Task 3: ExportDialog 启用三格式

**Files:** Modify `src/renderer/components/Dialogs/ExportDialog.tsx`

- [ ] **Step 1: 启用 word/pdf/epub**

定位 `formatOptions`（约 60-63 行），改为：
```tsx
  const formatOptions = [
    { value: 'markdown', label: 'Markdown', icon: <FileMarkdownOutlined />, desc: '纯文本格式，广泛支持', disabled: false },
    { value: 'word', label: 'Word文档', icon: <FileWordOutlined />, desc: '可编辑 .docx 文档', disabled: false },
    { value: 'pdf', label: 'PDF文档', icon: <FilePdfOutlined />, desc: '便携式文档，适合打印', disabled: false },
    { value: 'epub', label: '电子书', icon: <BookOutlined />, desc: 'ePub 格式，适合阅读器', disabled: false }
  ]
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit 2>&1 | grep ExportDialog`（无输出）；`npm run build`（通过）；`npm run lint`（0/0）。

- [ ] **Step 3: 提交**
```bash
git add src/renderer/components/Dialogs/ExportDialog.tsx
git commit -m "$(cat <<'EOF'
feat(export): ExportDialog 启用 word/pdf/epub 三种格式

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Workspace handleExport 按格式分支

**Files:** Modify `src/renderer/pages/Workspace/index.tsx`

- [ ] **Step 1: import exportDocument**

既有 ipcService import 行（约 27 行 `import { startAutoSave, stopAutoSave, saveFileDialog, writeFile, getStats, saveStats } from '../../services/ipcService'`）扩展加 `exportDocument`：
```tsx
import { startAutoSave, stopAutoSave, saveFileDialog, writeFile, getStats, saveStats, exportDocument } from '../../services/ipcService'
```

- [ ] **Step 2: 重写 handleExport 的后半段（按格式分支）**

将现有 `handleExport`（约 320-364 行，从「// 5) 拼装」到函数末尾）替换为按格式分支版本。前半段（flush→读→选章→空守卫，322-342 行）保持不变。替换从 `// 5) 拼装` 到 `return { ok: false }` 末尾：

```tsx
    // 5) 按格式选扩展名 + 过滤器
    const fmt = options.format
    const ext = fmt === 'word' ? 'docx' : fmt === 'pdf' ? 'pdf' : fmt === 'epub' ? 'epub' : 'md'
    const filterName = fmt === 'word' ? 'Word' : fmt === 'pdf' ? 'PDF' : fmt === 'epub' ? 'ePub' : 'Markdown'
    const savePath = await saveFileDialog(`${sanitizeFilename(projectName)}.${ext}`, [
      { name: filterName, extensions: [ext] }
    ])
    if (!savePath) return { ok: false }
    // 6) 生成/写盘：markdown 走本地拼装；word/pdf/epub 走主进程
    let ok = false
    try {
      if (fmt === 'markdown') {
        const md = assembleMarkdown({
          projectName,
          chapters: selected,
          addFrontMatter: options.options?.addFrontMatter ?? true,
          addToc: options.options?.addToc ?? true,
          date: new Date().toISOString().slice(0, 10)
        })
        ok = await writeFile(savePath, md)
      } else {
        ok = await exportDocument(fmt, {
          chapters: selected,
          projectName,
          options: {
            addFrontMatter: options.options?.addFrontMatter ?? true,
            addToc: options.options?.addToc ?? true
          },
          savePath
        })
      }
    } catch (e) {
      console.error('导出失败:', e)
      ok = false
    }
    if (ok) {
      message.success('导出成功')
      return { ok: true }
    }
    message.error('导出失败')
    return { ok: false }
```

> 注意 `fmt` 类型：`options.format` 是 `'markdown'|'word'|'pdf'|'epub'`；`exportDocument(fmt, ...)` 的 fmt 在 else 分支已收窄为 `'word'|'pdf'|'epub'`（因 markdown 已 return）。若 TS 未收窄，显式 `exportDocument(fmt as 'word'|'pdf'|'epub', ...)`。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit 2>&1 | grep "pages/Workspace"`（仅既有 TS6133 React/Title/loading/handleDeleteChapter，无新增）；`npm run build`（通过）；`npm run lint`（0/0）。

- [ ] **Step 4: 手动冒烟（核心）**

Run: `npm run dev`，建 3 章带中文内容的项目：
1. 导出 Markdown → `.md` 正常（回归）。
2. 导出 Word → `.docx`：用 Word 打开，章节标题 + 正文段落正确，中文无乱码。
3. 导出 PDF → `.pdf`：PDF 阅读器打开，A4、CJK、章节分段、（勾选时）目录页/标题。
4. 导出 ePub → `.epub`：Calibre/阅读器打开，章节 + 内置 TOC 正确。
5. 取消保存框 → 静默无错误；导出失败 → 报错。
6. 四种格式在 ExportDialog 均可选。

- [ ] **Step 5: 提交**
```bash
git add src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(export): handleExport 按格式分支，接入 word/pdf/epub 主进程生成

markdown 走 assembleMarkdown+writeFile；word/pdf/epub 走 exportDocument；
格式专属保存框扩展名/过滤器；保留 {ok} 关弹窗契约。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 文档状态更新（阶段17 全完成）

**Files:** Modify `docs/AUDIT.md`、`README.md`、`docs/DEVELOPMENT.md`

- [ ] **Step 1: AUDIT.md 追加批次5 段**

在批次4 复审段之后插入：
```markdown
## 2026-08-03 复审：批次 5 导出 Word/PDF/ePub

分支 `feat/export-formats`，详见 `docs/superpowers/plans/2026-08-03-export-formats.md`。已实现：

- **导出 Word/PDF/ePub（阶段17 完成）**：主进程生成——`docx` 库生成 Word、`epub-gen-memory` 生成 ePub（内置 TOC）、Electron `printToPDF` 经临时 HTML 文件生成 PDF（CJK 字体栈、支持长篇）。renderer 复用 Markdown 管线并按格式分支；ExportDialog 启用三格式。新增依赖 docx + epub-gen-memory。

至此阶段17（导入导出）全部完成（Markdown + Word + PDF + ePub）。仅余「每章一文件」「导入」未做。
```

- [ ] **Step 2: README.md 阶段17 行 → `✅ 已实现（Markdown/Word/PDF/ePub 导出）`**；真实进度链路更新，待办移除 Word/PDF/ePub（仅余可选的每章一文件/导入）。

- [ ] **Step 3: DEVELOPMENT.md 阶段17 行 → `✅ 已实现`**。

- [ ] **Step 4: 提交**
```bash
git add docs/AUDIT.md README.md docs/DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
docs: 更新进度（批次5 导出 Word/PDF/ePub 完成；阶段17 全完成）

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 收尾验证（全部 Task 完成后）

- `npx tsc --noEmit`：被改文件无新错误（基线 31）。
- `npm run build`：通过（含 main）。
- `npm run lint`：保持 0/0。
- 完整手动冒烟（4 种格式连续导出）。
- `git log --oneline feat/export-formats ^main`：确认提交（spec + 5 task）。

## 后续

合并 `feat/export-formats` 后，阶段17 全部完成。剩余可选：每章一文件导出、导入功能。

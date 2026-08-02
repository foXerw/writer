# 批次 2 设计：导出功能 —— Markdown（Export — Markdown）

> 日期: 2026-08-02
> 范围: 把空壳导出功能做成真实可用的 Markdown 导出（单文件，含可选前言/目录/章节范围）
> 依据: `docs/AUDIT.md`（阶段17 空壳）+ 2026-08-02 代码复核
> 关联: 4 批路线图的第 2 批（批次1 稳定与打磨已合并 main）。本批**仅做 Markdown**；Word/PDF/ePub 禁用留位，留给后续。

---

## 背景与现状（已复核）

- `src/renderer/components/Dialogs/ExportDialog.tsx` **已写得相当完整**：格式选择（markdown/word/pdf/epub）、章节范围（current/all/selected）、前言/目录选项、`onExport(options)` 回调都已定义。但：
  - **从未被任何组件渲染**（孤儿组件）。
  - `handleExport` 用 `setInterval` 每 200ms +10% **假装进度**，纯演戏；`onExport` 无父组件提供。
- 主进程 IPC 积木齐全，**无需新增**：`dialog:saveFile`（保存对话框→返回路径）、`file:write`（写字符串到文件）、`chapter:getAll`（读全部章节，按文件名排序）。
- `Workspace` 的 `useMenu` **不处理 `'export'`**（`menu.ts` 在 Ctrl+E / 工具→导出项目 发送 `'export'`，命中 `default`）。
- `package.json` **无** docx/epub/pdf 库；Markdown 为纯字符串拼接，**零新依赖**。

## 目标

真实、端到端可用的 Markdown 导出：用户触发 → 选范围/选项 → 系统保存对话框 → 生成 `.md` 文件落到指定路径。其余三种格式在 UI 中禁用并标注「即将支持」。

---

## 架构与文件

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/renderer/services/exportService.ts` | **新建**：纯函数 `assembleMarkdown` + `slugify` + `sanitizeFilename` | 新建 |
| `src/renderer/pages/Workspace/index.tsx` | `exportDialogOpen` 状态；渲染 `<ExportDialog>`；`useMenu` 处理 `'export'`；实现真实 `handleExport` | 修改 |
| `src/renderer/components/Dialogs/ExportDialog.tsx` | 删除假 `setInterval` 进度；word/pdf/epub 禁用并标「即将支持」；保留 md/范围/选项 UI | 修改 |
| `src/renderer/components/Editor/EditorToolbar.tsx` | 加一个导出按钮（次要触发入口） | 修改 |
| 主进程 / preload / package.json | **不改**，**不加依赖** | — |

---

## 组件设计

### `exportService.ts`（新建，纯函数，无 React 依赖）

把拼装逻辑独立出来：组件只管编排，拼装是可单独审视/复用的纯函数。

```ts
import type { Chapter } from '../common/ipc'

export interface AssembleOptions {
  projectName: string
  chapters: Chapter[]      // 已过滤、已按 order 排序
  addFrontMatter: boolean
  addToc: boolean
  date: string             // 'YYYY-MM-DD'，由调用方传入（保持函数纯净）
}

// 标题 → 锚点 slug：小写、空白/标点→连字符、去首尾连字符。
// 注意：CJK 标题经此处理基本保留原字，目录链接在不同渲染器里可能不完全跳转，
// 但目录本身仍是可读章节列表（本批接受，后续可增强）。
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s/\\#:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 项目名 → 安全文件名：替换非法路径字符。
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || '导出'
}

// 主拼装函数
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
```

### `Workspace/index.tsx`（修改）

- 新增状态 `const [exportDialogOpen, setExportDialogOpen] = useState(false)`。
- `useMenu` handler 增加 `case 'export': setExportDialogOpen(true); break`。
- `EditorToolbar` 传入新 prop `onExport={() => setExportDialogOpen(true)}`（或 `onOpenExport`，命名随工具栏既有风格）。
- 在 JSX 渲染（命令面板附近）：
  ```tsx
  <ExportDialog
    open={exportDialogOpen}
    onClose={() => setExportDialogOpen(false)}
    chapters={chapters}
    projectName={projectName}
    onExport={handleExport}
  />
  ```
- 新增真实 `handleExport`（见「导出流水线」）。

### `ExportDialog.tsx`（修改）

- **删除** `progressInterval` 的 `setInterval` 与 `exportProgress` 状态；保留 `exporting` 布尔（按钮 loading）。导出很快，不需要进度条。
- `formatOptions`：`word`/`pdf`/`epub` 三项的渲染加 `disabled`，描述改「即将支持」；默认 `format='markdown'`。
- `handleExport`：去掉假进度，直接 `setExporting(true)` → `await onExport(options)` → 成功提示+关闭 / 失败提示 → `setExporting(false)`。
- `ExportOptions` 类型、范围/前言/目录 UI 保持不变。

### `EditorToolbar.tsx`（修改）

- 加一个导出按钮（`DownloadOutlined` 或 `ExportOutlined`），点击触发 `onExport`。实现时先读现有 props/布局，按既有风格插入（plan 阶段给精确代码）。

---

## 导出流水线（`handleExport`，定义在 Workspace）

```ts
const handleExport = async (options: ExportOptions) => {
  if (!projectPath) return
  // 1) 先把当前章未保存编辑落盘（复用批次1 的 chokepoint）
  await saveCurrentChapter({ silent: true })
  // 2) 从磁盘读权威最新章节列表，按 order 排序
  const all = await getAllChapters(projectPath)
  const sorted = [...all].sort((a, b) => a.order - b.order)
  // 3) 按范围选章
  let selected: Chapter[]
  if (options.includeChapters === 'current') {
    selected = sorted.filter(c => c.id === currentChapter?.id)
  } else if (options.includeChapters === 'selected') {
    const ids = options.selectedChapterIds ?? []
    selected = sorted.filter(c => ids.includes(c.id))
  } else {
    selected = sorted
  }
  // 4) 空集合兜底
  if (selected.length === 0) {
    message.warning('无章节可导出')
    return
  }
  // 5) 拼装
  const md = assembleMarkdown({
    projectName,
    chapters: selected,
    addFrontMatter: options.options?.addFrontMatter ?? true,
    addToc: options.options?.addToc ?? true,
    date: new Date().toISOString().slice(0, 10)
  })
  // 6) 保存对话框（取消则静默中止）
  const savePath = await saveFileDialog(`${sanitizeFilename(projectName)}.md`)
  if (!savePath) return
  // 7) 写盘
  const ok = await writeFile(savePath, md)
  if (ok) message.success('导出成功')
  else message.error('导出失败')
}
```

**导入**：`saveFileDialog`、`writeFile` 从 `../../services/ipcService`；`getAllChapters` 已在 `useChapter` 解构；`assembleMarkdown`、`sanitizeFilename` 从新建 `../../services/exportService`；`ExportOptions` 类型从 `../../components/Dialogs/ExportDialog`。

---

## 边界与取舍

- **空项目/无章节**：步骤4 兜底 `message.warning('无章节可导出')`，不生成空文件。
- **保存对话框取消**：步骤6 `if (!savePath) return`，静默中止，不报错。
- **当前章有未保存编辑**：步骤1 `await saveCurrentChapter({silent:true})` 先落盘，保证导出 = 磁盘内容。`await`（非 fire-and-forget）确保写完再读。
- **'current' 范围取权威内容**：用 flush 后重新读取的 `sorted` 里匹配 `currentChapter.id` 的章，而非可能陈旧的内存 `currentChapter`。
- **文件名净化**：`sanitizeFilename` 去非法路径字符；空名兜底「导出」。
- **重复章节标题**：目录锚点可能碰撞——本批接受，后续可加序号去重。
- **CJK 标题锚点**：`slugify` 保留 CJK 原字，目录链接跳转依渲染器而定；目录仍可读。接受。
- **单文件输出**：多章拼成一个 `.md`；不做「每章一个文件」（ExportDialog 的 `chapterAsFile` 选项本批不接线，留位）。

## 范围外（明确不做）

- Word / PDF / ePub 实际生成（UI 禁用留位）。
- 「每章一个文件」导出（`chapterAsFile`）。
- 导入功能（阶段17 仅指_export_；导入另行处理）。
- 导出历史/最近导出路径记忆。
- 真实进度条（Markdown 导出是毫秒级，不需要）。

---

## 测试与验证（无测试框架）

- `npx tsc --noEmit`：被改文件不引入新错误（基线约 60）。
- `npm run build`：通过。
- `npm run lint`：仓库级因缺 `eslint-plugin-react-refresh` 而坏（既有），单文件可临时装该依赖 lint，或靠 tsc+build。
- 手动冒烟（`npm run dev`，建一个含 3 章+内容的项目）：
  1. Ctrl+E（或工具→导出项目，或工具栏导出按钮）→ 弹出 ExportDialog。
  2. 默认 Markdown、全部章节、前言+目录开 → 导出 → 保存对话框默认名 `<项目名>.md` → 选路径保存 → 成功提示。
  3. 打开产物：YAML 前言（title/date/chapters）+ `## 目录`（3 条带锚点链接）+ 3 章正文（`# 标题` 分隔）。内容正确。
  4. 范围=当前章节 → 产物只含当前章；范围=选择章节 → 只含选中章。
  5. 关闭「前言」「目录」→ 产物无对应段落。
  6. 保存对话框点取消 → 无错误、无文件。
  7. 当前章有未保存编辑时导出 → 产物含最新编辑（验证 flush 生效）。
  8. word/pdf/epub 三项显示「即将支持」且不可选。
  9. 回归：Ctrl+S 保存、切章、菜单切栏等批次1 功能不受影响。

## 涉及文件清单

新建 1 个（`exportService.ts`），修改 3 个（Workspace、ExportDialog、EditorToolbar）。预计净增约 90–130 行。主进程/preload/package.json 不动。

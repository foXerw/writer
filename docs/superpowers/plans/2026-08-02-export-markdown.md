# 批次 2 实现计划：导出功能 — Markdown（Export — Markdown）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把空壳导出功能做成真实可用的 Markdown 导出（单文件 + 可选前言/目录 + 章节范围）。

**Architecture:** 新建纯函数 `exportService.ts`（拼装/净化/slug）；Workspace 接线 `ExportDialog`（菜单 Ctrl+E + 工具栏按钮触发）并实现真实 `handleExport`（flush 当前章 → 磁盘读章节 → 选范围 → 拼装 → 保存框 → 写盘）；ExportDialog 去假进度条、禁用另 3 种格式。复用既有 IPC，无新依赖。

**Tech Stack:** Electron + React 18 + TypeScript + antd 5。无测试框架。

## Global Constraints

- **无单元测试框架**：每任务验证 = `npx tsc --noEmit`（被改文件不引入新错误，基线约 60）+ `npm run build` + 手动冒烟。无 pytest/vitest，不要因「无单元测试」判失败。
- **不引入新依赖**：package.json 不动。Word/PDF/ePub 实际生成不做（UI 禁用留位）。
- **主进程 / preload 不改**：复用既有 `dialog:saveFile` / `file:write` / `chapter:getAll`。
- **分支**：`feat/export-markdown`（已创建，spec 已提交于 `2310ed2`）。
- **提交规范**：Conventional Commits，中文，末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 子代理无法驱动 Electron GUI；手动冒烟由人在 `npm run dev` 下完成，作为最终交付前的人工关卡。

## 文件结构

| 文件 | 责任 | 任务 |
|------|------|------|
| `src/renderer/services/exportService.ts` | **新建**：`assembleMarkdown` / `slugify` / `sanitizeFilename` 纯函数 | Task 1 |
| `src/renderer/components/Dialogs/ExportDialog.tsx` | 去假进度、禁用 word/pdf/epub | Task 2 |
| `src/renderer/pages/Workspace/index.tsx` | 状态 + 渲染 ExportDialog + useMenu `'export'` + `handleExport` | Task 3 |
| `src/renderer/components/Editor/EditorToolbar.tsx` | 导出按钮触发入口 | Task 4 |
| `docs/AUDIT.md` / `README.md` / `docs/DEVELOPMENT.md` | 阶段17 状态更新 | Task 5 |

---

## Task 1: 新建 exportService.ts（纯拼装函数）

**Files:**
- Create: `src/renderer/services/exportService.ts`

**Interfaces:**
- Consumes: `Chapter`（`../common/ipc`）
- Produces: `assembleMarkdown(opts: AssembleOptions): string`、`slugify(title: string): string`、`sanitizeFilename(name: string): string`、`AssembleOptions`

- [ ] **Step 1: 创建文件，写入纯函数**

创建 `src/renderer/services/exportService.ts`：

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
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "exportService"`
Expected: 无输出（新文件零错误）。

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/services/exportService.ts
git commit -m "$(cat <<'EOF'
feat(export): 新增 exportService 纯函数（assembleMarkdown/slugify/sanitizeFilename）

章节→单 Markdown 字符串拼装，可选 YAML 前言与目录；无 React 依赖。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ExportDialog 去假进度 + 禁用另 3 种格式

**Files:**
- Modify: `src/renderer/components/Dialogs/ExportDialog.tsx`

**Interfaces:** 无新增导出；保留既有 `ExportOptions`、`ExportDialogProps`。

- [ ] **Step 1: 移除假进度相关状态与 import**

- 删除 import 中的 `Progress`（行 10 附近，`Progress` 在 `antd` 导入列表里）。**保留** `Divider`（仍被使用）。
- 删除状态 `const [exportProgress, setExportProgress] = useState(0)`（行 57 附近）。**保留** `exporting` 布尔。
- 删除 `handleExport` 内的 `setExportProgress(0)`（开头）、整个 `progressInterval = setInterval(...)` 块（行 75-83 附近）、`clearInterval(progressInterval)` 与 `setExportProgress(100)`（成功分支）、`finally` 里的 `setExportProgress(0)`。
- 删除 JSX 中 `{exporting && (<div>...<Progress .../></div>)}` 整块（行 219-230 附近）。

改造后 `handleExport` 形如：

```tsx
  const handleExport = async () => {
    setExporting(true)
    try {
      await onExport({
        format,
        includeChapters,
        selectedChapterIds: selectedChapters,
        options: { addFrontMatter, addToc }
      })
      messageApi.success('导出成功！')
      onClose()
    } catch (error) {
      messageApi.error('导出失败，请重试')
      console.error('Export error:', error)
    } finally {
      setExporting(false)
    }
  }
```

- [ ] **Step 2: 禁用 word/pdf/epub 三种格式**

在 `formatOptions` 数组（行 61-66 附近），给 `word`/`pdf`/`epub` 三项加 `disabled: true`，并把 `desc` 改为「即将支持」：

```tsx
  const formatOptions = [
    { value: 'markdown', label: 'Markdown', icon: <FileMarkdownOutlined />, desc: '纯文本格式，广泛支持', disabled: false },
    { value: 'word', label: 'Word文档', icon: <FileWordOutlined />, desc: '即将支持', disabled: true },
    { value: 'pdf', label: 'PDF文档', icon: <FilePdfOutlined />, desc: '即将支持', disabled: true },
    { value: 'epub', label: '电子书', icon: <BookOutlined />, desc: '即将支持', disabled: true }
  ]
```

> 给 markdown 也写 `disabled: false`，使 4 个对象形状一致，TS 推断为统一元素类型，`opt.disabled` 才可访问（否则联合类型上报错）。

并在 `Radio.Button` 渲染（行 130-155 附近）加 `disabled={opt.disabled}`：

```tsx
                    <Radio.Button
                      key={opt.value}
                      value={opt.value}
                      disabled={opt.disabled}
                      style={{
                        width: '100%',
                        height: 'auto',
                        padding: '12px 16px',
                        borderColor: format === opt.value ? '#1890ff' : '#333',
                        background: format === opt.value ? 'rgba(24, 144, 255, 0.1)' : 'transparent'
                      }}
                    >
```

（其余 label 内部 JSX 不变。）

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "ExportDialog"`
Expected: 无新增错误（既有 TS6133 `Title`/`onThemeChange`... 不在此文件；本文件既有 `@/common/ipc` TS2307 是 pre-existing，保留——不在本任务范围）。确认 Progress 移除后无「Progress 未定义」错误。

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: 手动冒烟（可推迟到 Task 3 接线后一起验）**

ExportDialog 目前仍未渲染；本任务的 UI 变化在 Task 3 接线后才能在界面看到。记录此处，Task 3 后一并验证：另 3 种格式显示「即将支持」且不可选；导出按钮无进度条。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/Dialogs/ExportDialog.tsx
git commit -m "$(cat <<'EOF'
refactor(export): ExportDialog 去假进度条、禁用 word/pdf/epub

删除 setInterval 假进度，保留 exporting 布尔做按钮 loading；
另 3 种格式标「即将支持」并 disabled，默认 Markdown。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Workspace 接线导出（核心集成）

**Files:**
- Modify: `src/renderer/pages/Workspace/index.tsx`

**Interfaces:**
- Consumes: `assembleMarkdown`/`sanitizeFilename`（Task 1）、`ExportDialog`/`ExportOptions`（既有）、`saveFileDialog`/`writeFile`（`ipcService`）、`getAllChapters`（`useChapter`，已解构）、`saveCurrentChapter`（批次1 既有）、`currentChapter`/`projectPath`/`projectName`/`chapters`/`message`（组件内既有）
- Produces: `handleExport(options: ExportOptions): Promise<void>`、`exportDialogOpen` 状态

- [ ] **Step 1: 补 import**

在 `Workspace/index.tsx` 顶部 import 区：
- 新增 `import ExportDialog from '../../components/Dialogs/ExportDialog'`
- 新增 `import type { ExportOptions } from '../../components/Dialogs/ExportDialog'`
- 在既有 `import { startAutoSave, stopAutoSave } from '../../services/ipcService'` 一行，扩展为 `import { startAutoSave, stopAutoSave, saveFileDialog, writeFile } from '../../services/ipcService'`
- 新增 `import { assembleMarkdown, sanitizeFilename } from '../../services/exportService'`

- [ ] **Step 2: 新增导出弹窗状态**

在组件内既有状态声明区（`commandPaletteOpen`/`outlineVisible` 附近）加：

```tsx
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
```

- [ ] **Step 3: 实现 handleExport**

在 `handleCommand` 附近（或 `handleBack` 之后）新增：

```tsx
  // 导出 Markdown：flush 当前章 → 磁盘读权威章节 → 按范围选 → 拼装 → 保存框 → 写盘
  const handleExport = async (options: ExportOptions) => {
    if (!projectPath) return
    // 1) 先把当前章未保存编辑落盘（复用批次1 chokepoint）
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

> 注：`handleExport` 引用 `saveCurrentChapter`/`getAllChapters`/`currentChapter`/`projectPath`/`projectName`/`message`，均为组件内既有标识符，闭包正确。

- [ ] **Step 4: useMenu 增加 'export' case**

在 `useMenu((event, ...args) => { switch... })` 的 `default:` 之前加：

```tsx
      case 'export':
        setExportDialogOpen(true)
        break
```

- [ ] **Step 5: 渲染 ExportDialog**

在 `<CommandPalette ... />` 附近（JSX 顶部，与命令面板并列）加：

```tsx
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        chapters={chapters}
        projectName={projectName}
        onExport={handleExport}
      />
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "pages/Workspace"`
Expected: 无新增错误（既有 TS6133 `React`/`Title`/`loading`/`handleDeleteChapter` 为 pre-existing，保留）。

- [ ] **Step 7: 构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 8: 手动冒烟（核心验证）**

Run: `npm run dev`，打开/新建含 3 章+内容的项目。
1. 菜单「工具 → 导出项目」(Ctrl+E) → 弹出 ExportDialog。
2. 默认 Markdown、全部、前言+目录开 → 导出 → 保存框默认名 `<项目名>.md` → 保存 → 「导出成功」。
3. 打开产物：YAML 前言（title/date/chapters）+ `## 目录`（3 条锚点链接）+ 3 章正文（`# 标题` 分隔）。内容正确。
4. 范围=当前章节 → 仅当前章；范围=选择章节 → 仅选中章。
5. 关闭「前言」「目录」→ 产物无对应段。
6. 保存框取消 → 无错误、无文件。
7. 当前章有未保存编辑时导出 → 产物含最新编辑（flush 生效）。
8. word/pdf/epub 三项「即将支持」且不可选；无进度条。

- [ ] **Step 9: 提交**

```bash
git add src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(export): Workspace 接线 ExportDialog 并实现真实 Markdown 导出

菜单 Ctrl+E 打开导出弹窗；handleExport 先 flush 当前章、再从磁盘读
权威章节、按范围选拼装、保存框写盘。复用既有 IPC，零新依赖。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: EditorToolbar 导出按钮（次要触发）

**Files:**
- Modify: `src/renderer/components/Editor/EditorToolbar.tsx`
- Modify: `src/renderer/pages/Workspace/index.tsx`（给 EditorToolbar 传 `onExport`）

**Interfaces:**
- EditorToolbar 新增可选 prop `onExport?: () => void`

- [ ] **Step 1: EditorToolbar 加 import 与 prop**

- 在图标 import（行 3-14）加 `DownloadOutlined`：

```tsx
import {
  BoldOutlined,
  ItalicOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  ColumnWidthOutlined,
  SaveOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  EditOutlined,
  DownloadOutlined
} from '@ant-design/icons'
```

- 在 `EditorToolbarProps`（行 17-32）加 `onExport?: () => void`，并在解构（行 34-49）加 `onExport`。

- [ ] **Step 2: 在右侧 Space 加导出按钮**

在「保存按钮」Tooltip 之前（行 192 附近的分隔线之后、保存按钮之前）插入：

```tsx
        {/* 导出按钮 */}
        <Tooltip title="导出 (Ctrl+E)">
          <Button
            type="text"
            icon={<DownloadOutlined />}
            onClick={onExport}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>

```

- [ ] **Step 3: Workspace 给 EditorToolbar 传 onExport**

在 `Workspace/index.tsx` 的 `<EditorToolbar ... />`（行 435 附近）加 prop：

```tsx
          <EditorToolbar
            onSave={handleSave}
            onExport={() => setExportDialogOpen(true)}
            chapterTitle={chapterTitle}
            onTitleChange={setChapterTitle}
            wordCount={editorContent.length}
            focusMode={focusMode}
            typewriterMode={typewriterMode}
            onToggleFocus={setFocusMode}
            onToggleTypewriter={setTypewriterMode}
          />
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "EditorToolbar|pages/Workspace"`
Expected: 无新增错误。

- [ ] **Step 5: 构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 6: 手动冒烟**

Run: `npm run dev`，进入工作区。
1. 工具栏右侧出现导出图标按钮 → 点击 → 弹出 ExportDialog（与 Ctrl+E 一致）。
2. 回归：保存按钮、专注/打字机按钮、字数统计不受影响。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/components/Editor/EditorToolbar.tsx src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(export): EditorToolbar 加导出按钮（次要触发入口）

右侧 Space 加 DownloadOutlined 按钮，onClick 调 onExport 打开导出弹窗。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 文档状态更新（阶段17）

**Files:**
- Modify: `docs/AUDIT.md`（追加 2026-08-02 导出复审段）
- Modify: `README.md`（阶段17 行 + 真实进度段）
- Modify: `docs/DEVELOPMENT.md`（总览表阶段17 行）

- [ ] **Step 1: AUDIT.md 追加复审段**

在 `docs/AUDIT.md` 的「## 2026-08-02 复审：批次 1 稳定与打磨」段之后，插入：

```markdown
## 2026-08-02 复审：批次 2 导出（Markdown）

分支 `feat/export-markdown`，详见 `docs/superpowers/plans/2026-08-02-export-markdown.md`。已修复：

- **导出功能（阶段17 空壳）**：ExportDialog 从未渲染 → 接进 Workspace（菜单 Ctrl+E + 工具栏按钮触发）；`handleExport` 真实实现：flush 当前章 → `chapter:getAll` 读权威章节 → 按范围（当前/全部/选定）选 → `exportService.assembleMarkdown` 拼装（可选 YAML 前言 + 目录）→ `dialog:saveFile` → `file:write`。删除假进度条。复用既有 IPC，零新依赖。

仍待做（阶段17 未完成部分）：Word / PDF / ePub 实际生成（UI 已禁用并标「即将支持」）；「每章一个文件」导出；导入功能。阶段 16（统计重做）、15（快捷键自定义）仍待做。
```

- [ ] **Step 2: README.md 更新阶段17 行与真实进度**

- 阶段17 表行状态改为：`🔄 部分（Markdown 已实现；Word/PDF/ePub 待做）`。
- 「真实进度」段在链路描述末尾追加「+ Markdown 导出」，并在仍待做列表保留「Word/PDF/ePub 导出」。

- [ ] **Step 3: DEVELOPMENT.md 更新总览表阶段17**

阶段17 行状态改为：`🔄 部分（Markdown）`（与 README 一致；其余行不动——DEVELOPMENT 表的 8/10-14 历史漂移是既有问题，不在本批范围，留待统一同步）。

- [ ] **Step 4: 提交**

```bash
git add docs/AUDIT.md README.md docs/DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
docs: 更新进度（批次2 Markdown 导出完成）

阶段17 标「部分（Markdown 已实现，Word/PDF/ePub 待做）」；
AUDIT 追加批次2 复审段。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 收尾验证（全部 Task 完成后）

- `npx tsc --noEmit`：总错误数 ≤ 60，被改文件无新错误。
- `npm run build`：通过。
- 完整手动冒烟（合并各 Task 冒烟步骤连续走一遍）。
- `git log --oneline feat/export-markdown ^main`：确认提交（spec + 5 task）。

## 后续

本批完成后进入**批次 3：写作统计（阶段16）**，开新 spec → 计划 → 实现。合并 `feat/export-markdown` 到 main 的时机由用户决定（finishing-a-development-branch）。

# 批次 1 实现计划：稳定与打磨（Stability & Polish）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复切章/返回/关窗的数据丢失、菜单 Ctrl+1/2 切换侧栏、Tab 右键菜单、Settings 页接线 4 项缺陷。

**Architecture:** 集中 chokepoint flush（`saveCurrentChapter` + `flushIfDirty`）+ ref 稳定订阅（beforeunload/autosave）；菜单事件在 Workspace `useMenu` handler 增加 case；Tab 右键用 antd `Dropdown trigger=contextMenu` 包裹复用既有关闭逻辑；Settings 页渲染既有 `ThemeSettings` 并加齿轮入口。均为 renderer 层改动，无 IPC/主进程变更。

**Tech Stack:** Electron + React 18 + TypeScript + antd 5 + Zustand + Monaco。无测试框架。

## Global Constraints

- **无单元测试框架**：每个任务的「测试循环」= 类型检查 + lint + 手动冒烟（`npm run dev`），而非 pytest/vitest。下文每个 Task 的验证步骤均按此执行。
- **类型检查基线**：`npx tsc --noEmit` 当前有 62 个既有错误（见 `docs/superpowers/specs/tsc-baseline.txt`，多为 antd 类型/import type 路径）。**验收标准：本任务触及的文件不引入新错误**（用 `npx tsc --noEmit 2>&1 | grep "<file>"` 确认被改文件零新错误，总错误数不增长）。
- **构建**：`npm run build`（electron-vite，esbuild）须通过。
- **Lint**：`npm run lint` 须对改动文件通过（可 `npx eslint <file>`）。
- **分支**：`feat/stability-and-polish`（已创建并在此分支提交了 spec）。
- **提交规范**：Conventional Commits，中文描述，末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **不动**：主进程 IPC、preload、自动保存开关/间隔配置 UI、浅色主题、`plot` 面板。

## 文件结构

| 文件 | 责任 | 改动 |
|------|------|------|
| `src/renderer/pages/Workspace/index.tsx` | 工作区主编排：章节状态、保存、菜单分发、侧栏 | Task 1（flush）、Task 2（菜单 case）、Task 4（齿轮入口） |
| `src/renderer/components/Layout/EditorTabs.tsx` | Tab 栏：切换/关闭/溢出菜单 | Task 3（右键菜单） |
| `src/renderer/pages/Settings/index.tsx` | 设置页 | Task 4（渲染 ThemeSettings + 返回） |
| `docs/AUDIT.md`、`README.md`、`docs/DEVELOPMENT.md` | 进度/审计记录 | Task 5（状态更新） |

`ThemeSettings.tsx`、`stores/index.ts`、`useMenu.ts`、`menu.ts`、`ipcService.ts` **本批不改**。

---

## Task 1: 切章数据丢失修复（核心）

**Files:**
- Modify: `src/renderer/pages/Workspace/index.tsx`（`handleSave` 约 154-169、`handleSaveRef` 约 171-174、`selectChapter` 约 133-137、自动保存 effect 约 183-195、`handleBack` 约 216-218）

**Interfaces:**
- Consumes: `updateChapter(projectPath, chapter)`（`useChapter`）、`isDirtyRef`、`editorContentRef`、`message`（antd App）
- Produces:
  - `saveCurrentChapter(opts?: { silent?: boolean }): Promise<void>`
  - `handleSave(): void`（= silent:false，手动保存，**不被 dirty 门控**——尊重显式 Ctrl+S）
  - `flushIfDirty(): void`（= silent:true，**被 dirty 门控**，切章/返回/关窗/autosave 用）
  - `flushIfDirtyRef`（ref，供 autosave/beforeunload 稳定订阅）

**背景：竞态处理（重要）**——`saveCurrentChapter` 是 fire-and-forget 异步。若切到 B 章后 A 的存盘才 resolve，直接 `setCurrentChapter(updatedA)` 会把 UI 回切到 A。故：用**函数式更新 + id 守卫**，仅当 `currentChapter` 仍是同一章时才同步；`setChapters`/`setOpenedChapters` 同样用函数式更新避免陈旧闭包。手动保存不门控 dirty（防止「Ctrl+S 无反应」）；静默 flush 门控 dirty（避免无谓写盘）。

- [ ] **Step 1: 替换 `handleSave`，新增 `saveCurrentChapter` / `flushIfDirty`**

定位 `src/renderer/pages/Workspace/index.tsx` 中现有 `handleSave`（约 154-169 行，从 `// 保存章节` 注释到其闭合 `}`），整段替换为：

```tsx
  // 保存当前章节到磁盘。silent=true 用于切章/返回/关窗/自动保存的静默 flush。
  const saveCurrentChapter = async (opts?: { silent?: boolean }): Promise<void> => {
    if (!currentChapter || !projectPath) return
    // 静默 flush：无脏数据则跳过；手动保存（silent=false）尊重显式 Ctrl+S，不门控 dirty。
    if (opts?.silent && !isDirtyRef.current) return
    const outgoing = currentChapter
    try {
      const updated = await updateChapter(projectPath, {
        ...outgoing,
        title: chapterTitle,
        content: editorContent
      })
      // 函数式更新避免陈旧闭包；仅当仍是同一章时同步 currentChapter，防止切走后被回写。
      setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)))
      setOpenedChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)))
      setCurrentChapter(prev => (prev && prev.id === updated.id ? updated : prev))
      isDirtyRef.current = false
      if (!opts?.silent) {
        message.success('保存成功')
      }
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 手动保存（Ctrl+S / 菜单保存 / 工具栏）：带成功提示，不门控 dirty。
  const handleSave = () => {
    void saveCurrentChapter({ silent: false })
  }

  // 静默 flush 脏数据：切章 / 返回 / 关窗 / 自动保存调用。
  const flushIfDirty = () => {
    void saveCurrentChapter({ silent: true })
  }
```

- [ ] **Step 2: 用 `flushIfDirtyRef` 替换 `handleSaveRef`**

定位现有 `handleSaveRef` + 其 `useEffect`（约 171-174 行）：

```tsx
  const handleSaveRef = useRef(handleSave)
  useEffect(() => {
    handleSaveRef.current = handleSave
  })
```

整段替换为：

```tsx
  const flushIfDirtyRef = useRef(flushIfDirty)
  useEffect(() => {
    flushIfDirtyRef.current = flushIfDirty
  })
```

- [ ] **Step 3: `selectChapter` 切换前 flush**

定位 `selectChapter`（约 133-137 行）：

```tsx
  const selectChapter = (chapter: Chapter) => {
    setCurrentChapter(chapter)
    setEditorContent(chapter.content)
    setChapterTitle(chapter.title)
  }
```

替换为（在覆盖状态前先 flush 当前章；此时 `editorContent`/`currentChapter` 仍是离开章的值，闭包正确）：

```tsx
  const selectChapter = (chapter: Chapter) => {
    flushIfDirty() // 先保存即将离开的当前章（若脏）
    setCurrentChapter(chapter)
    setEditorContent(chapter.content)
    setChapterTitle(chapter.title)
  }
```

- [ ] **Step 4: 自动保存改用静默 flush（顺带消除每 30s 弹 toast 的既有 annoy）**

定位自动保存 `useEffect`（约 183-195 行），将其中的 `onSave` 由调用 `handleSaveRef.current()` 改为 `flushIfDirtyRef.current()`：

```tsx
  // 自动保存：按配置间隔静默写盘（不弹 toast）
  useEffect(() => {
    if (!currentChapter || !autoSaveEnabled) return
    startAutoSave({
      interval: autoSaveInterval,
      onSave: () => {
        void flushIfDirtyRef.current()
        return editorContentRef.current
      }
    })
    return () => stopAutoSave()
  }, [currentChapter?.id, autoSaveEnabled, autoSaveInterval])
```

- [ ] **Step 5: `handleBack` 返回前 flush**

定位 `handleBack`（约 216-218 行）：

```tsx
  const handleBack = () => {
    navigate('/')
  }
```

替换为：

```tsx
  const handleBack = () => {
    flushIfDirty()
    navigate('/')
  }
```

- [ ] **Step 6: 新增 `beforeunload` 兜底 flush**

在自动保存 `useEffect` 之后（或 `handleBack` 之后任意稳定位置）新增：

```tsx
  // 关窗/退出兜底：fire-and-forget 触发一次 flush（异步 IPC，尽力而为）。
  // 主要保障是切章/返回的显式 flush；此处为最后兜底。
  useEffect(() => {
    const handler = () => flushIfDirtyRef.current()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "pages/Workspace"`
Expected: 无输出（Workspace 无类型错误）。若输出新错误，修正。（既有 62 个错误应不含本文件新错误。）

- [ ] **Step 8: Lint**

Run: `npx eslint src/renderer/pages/Workspace/index.tsx`
Expected: 无 error（warning 可接受）。

- [ ] **Step 9: 手动冒烟（数据安全）**

Run: `npm run dev`，打开/新建一个项目，进入工作区。
1. 新建章节 A，输入若干字（**不按 Ctrl+S**，等待 <30s），立即点击章节树中的章节 B → 切回 A：**A 的内容仍在**。
2. 在 A 编辑（<30s 未保存），点左上返回首页箭头 → 重新进入该项目打开 A：**内容仍在**。
3. 在 A 编辑（<30s 未保存），直接关闭窗口 → 重开应用进入项目打开 A：**内容仍在**（beforeunload 兜底）。
4. 回归：Ctrl+S 仍弹「保存成功」；编辑后停留 >30s，自动保存触发但**不弹 toast**，内容已写盘（关闭重开验证）。
5. 回归：专注模式（F8）、打字机（F9）、大纲（Ctrl+Shift+O）正常。

- [ ] **Step 10: 提交**

```bash
git add src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
fix(workspace): 切章/返回/关窗前 flush 脏数据，修复编辑丢失

- 新增 saveCurrentChapter({silent})，集中 chokepoint；函数式更新 + id 守卫防异步回写
- selectChapter/handleBack 切换前 flush；beforeunload 兜底
- 自动保存改静默 flush，消除每 30s 弹 toast
- 手动保存不门控 dirty，尊重显式 Ctrl+S

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**已知可接受残留（写入 AUDIT Task 5）**：`flushIfDirty` 为 fire-and-forget；极窄窗口内（IPC 往返期间用户立即编辑新章）`isDirtyRef` 可能在 outgoing 存盘 resolve 时被置 false 一次，但手动 Ctrl+S 不受 dirty 门控、下一轮 autosave/编辑会重新置脏，风险可忽略。

---

## Task 2: 菜单事件切换侧栏 tab（Ctrl+1/2 等）

**Files:**
- Modify: `src/renderer/pages/Workspace/index.tsx`（`useMenu` handler 约 241-264）

**Interfaces:**
- Consumes: `setSidebarTab`、`setSidebarCollapsed`（组件内 state）、`SidebarTab` 类型
- Produces: 无（行为补全）

**背景**：`menu.ts` 已发 `characters`(Ctrl+1)/`settings`(Ctrl+2，世界观设定)/`wordCount`(Ctrl+Shift+W)/`dailyStats`(Ctrl+Shift+D)/`plot`(Ctrl+3)。Workspace 未处理 → 落 `default`。注意：菜单事件 `'settings'` 对应侧栏 tab `'settings'`（即 `SettingPanel` 世界观设定），**不是** `/settings` 偏好页（后者由 Task 4 齿轮入口触发）。

- [ ] **Step 1: 在 `useMenu` handler 增加 case**

定位 `useMenu((event, ...args) => { ... })`（约 241-264 行），在 `default:` 之前插入：

```tsx
      case 'characters':
        setSidebarTab('characters')
        setSidebarCollapsed(false)
        break
      case 'settings': // 菜单「世界观设定」(Ctrl+2) → 侧栏设定 tab（非偏好页）
        setSidebarTab('settings')
        setSidebarCollapsed(false)
        break
      case 'wordCount':
      case 'dailyStats':
        setSidebarTab('stats')
        setSidebarCollapsed(false)
        break
      // 'plot' (Ctrl+3) 无对应面板，暂不处理
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "pages/Workspace"`
Expected: 无输出。

- [ ] **Step 3: Lint**

Run: `npx eslint src/renderer/pages/Workspace/index.tsx`
Expected: 无 error。

- [ ] **Step 4: 手动冒烟**

Run: `npm run dev`，进入工作区。
1. 菜单「工具 → 角色卡片」(Ctrl+1)：侧栏切到「角色」tab；若侧栏收起，自动展开。
2. 「工具 → 世界观设定」(Ctrl+2)：切到「设定」tab + 展开。
3. 「写作 → 字数统计」(Ctrl+Shift+W) 与「写作 → 今日写作」(Ctrl+Shift+D)：切到「统计」tab + 展开。
4. 先 Ctrl+B 收起侧栏，再 Ctrl+1：侧栏展开并显示角色 tab。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): 菜单 Ctrl+1/2/字数/今日写作 切换侧栏 tab

工具→角色(Ctrl+1)/世界观(Ctrl+2)、写作→字数/今日写作 命中 useMenu
default 分支的问题修复；收起时自动展开。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Tab 右键上下文菜单

**Files:**
- Modify: `src/renderer/components/Layout/EditorTabs.tsx`（imports 1-11、handlers 38-67、items map 92-136、`handleContextMenu` 148-150 及其 `onContextMenu` 绑定约 161）

**Interfaces:**
- Consumes: `removeTab`（useTabStore）、`onCloseChapter`、`chapters`、antd `Dropdown`/`MenuProps`、图标
- Produces:
  - `handleCloseRight(targetId: string): void`
  - `handleCloseOthersThan(targetId: string): void`
  - `contextMenuItems(chapter: Chapter): MenuProps['items']`

- [ ] **Step 1: 新增两个 handler**

在 `EditorTabs` 内 `handleCloseAll` 之后（约 57 行后）插入：

```tsx
  // 关闭指定 tab 右侧的所有 tab（不含 target）
  const handleCloseRight = useCallback((targetId: string) => {
    const idx = chapters.findIndex(c => c.id === targetId)
    if (idx < 0) return
    chapters.slice(idx + 1).forEach(c => {
      removeTab(c.id)
      onCloseChapter(c.id)
    })
  }, [chapters, removeTab, onCloseChapter])

  // 关闭除 target 外的所有 tab（以右键 target 为基准，区别于以激活 tab 为基准的 handleCloseOthers）
  const handleCloseOthersThan = useCallback((targetId: string) => {
    chapters.filter(c => c.id !== targetId).forEach(c => {
      removeTab(c.id)
      onCloseChapter(c.id)
    })
  }, [chapters, removeTab, onCloseChapter])
```

- [ ] **Step 2: 新增 `contextMenuItems` 构造器**

在 `menuItems`（溢出菜单，约 70-89 行）定义之后插入：

```tsx
  // 单个 tab 的右键菜单项（以右键的 target chapter 为基准）
  const contextMenuItems = useCallback((chapter: Chapter): MenuProps['items'] => [
    { key: 'close', icon: <CloseOutlined />, label: '关闭', onClick: () => handleClose(chapter.id) },
    { key: 'closeOthers', icon: <CloseCircleOutlined />, label: '关闭其他', onClick: () => handleCloseOthersThan(chapter.id) },
    { key: 'closeRight', icon: <ColumnWidthOutlined />, label: '关闭右侧', onClick: () => handleCloseRight(chapter.id) },
    { key: 'closeAll', icon: <CloseCircleOutlined />, label: '关闭全部', onClick: handleCloseAll }
  ], [handleClose, handleCloseOthersThan, handleCloseRight, handleCloseAll])
```

- [ ] **Step 3: 用 `Dropdown` 包裹每个 tab 的 label**

定位 `items` map 中每个 item 的 `label:`（约 94-134 行），把现有 `<span ...>...</span>` 用 `<Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems(chapter) }}>` 包裹。即把：

```tsx
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', height: 32 }}>
        {/* ...原有内容（标题、状态点、关闭按钮）... */}
      </span>
    ),
```

改为：

```tsx
    label: (
      <Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems(chapter) }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', height: 32', cursor: 'default' }}>
          {/* ...原有内容保持不变（标题、状态点、关闭按钮）... */}
        </span>
      </Dropdown>
    ),
```

（仅在最外层加 `<Dropdown>` 包裹与 `cursor: 'default'`，内部 JSX 原样保留。）

- [ ] **Step 4: 删除空 `handleContextMenu` 及其绑定**

删除 `handleContextMenu`（约 148-150 行）：

```tsx
  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }
```

并删除容器 `<div ... onContextMenu={handleContextMenu}>`（约 152-162 行）上的 `onContextMenu={handleContextMenu}` 属性（其余属性保留）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "EditorTabs"`
Expected: 无输出。

- [ ] **Step 6: Lint**

Run: `npx eslint src/renderer/components/Layout/EditorTabs.tsx`
Expected: 无 error。

- [ ] **Step 7: 手动冒烟**

Run: `npm run dev`，进入工作区，打开 3+ 个章节 tab。
1. 在某个 tab 上**右键**：出现菜单（关闭 / 关闭其他 / 关闭右侧 / 关闭全部）。
2. 点「关闭」：仅关该 tab。
3. 右键中间 tab →「关闭右侧」：仅关其右侧 tab，自身与左侧保留。
4. 右键某 tab →「关闭其他」：以**右键的 tab** 为基准保留，其余关闭（即使它非激活 tab）。
5. 「关闭全部」：所有 tab 关闭。
6. 左键溢出菜单（`...`）仍可用（回归）。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/components/Layout/EditorTabs.tsx
git commit -m "$(cat <<'EOF'
feat(editor-tabs): Tab 右键上下文菜单（关闭/其他/右侧/全部）

用 Dropdown trigger=contextMenu 包裹每个 tab label，复用既有关闭逻辑；
新增 handleCloseRight/handleCloseOthersThan（以右键 target 为基准）。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Settings 页接线 + 工作区齿轮入口

**Files:**
- Modify: `src/renderer/pages/Settings/index.tsx`（整文件重写，当前 1-17 行）
- Modify: `src/renderer/pages/Workspace/index.tsx`（侧栏头部约 302-331 加齿轮按钮）

**Interfaces:**
- Consumes: `ThemeSettings`（`components/Settings/ThemeSettings`，不改其内部）、antd、`useNavigate`、`SettingOutlined`（Workspace 已导入）
- Produces: 可达的 `/settings` 页（渲染 ThemeSettings）+ Workspace 侧栏齿轮按钮入口

- [ ] **Step 1: 重写 `pages/Settings/index.tsx`**

整文件替换为：

```tsx
import React from 'react'
import { Button, Typography } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ThemeSettings from '../../components/Settings/ThemeSettings'

const { Title } = Typography

function Settings() {
  const navigate = useNavigate()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <Button
          type="text"
          icon={<LeftOutlined />}
          onClick={() => navigate(-1)}
          style={{ color: '#d4d4d4' }}
        />
        <Title level={5} style={{ color: '#d4d4d4', margin: 0 }}>设置</Title>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ThemeSettings />
      </div>
    </div>
  )
}

export default Settings
```

- [ ] **Step 2: Workspace 侧栏头部加齿轮入口**

定位侧栏「顶部项目信息」区块（约 302-331 行）。当前结构为：外层 `<div style={{ ... justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>` 内有 `{!sidebarCollapsed && (<Space>返回+项目名</Space>)}` 与 `{sidebarCollapsed && (<Button>返回</Button>)}`。

在 `{!sidebarCollapsed && (<Space>...</Space>)}` 之后、`{sidebarCollapsed && ...}` 之前，新增一个齿轮按钮（space-between 使其落在右侧）：

```tsx
          {!sidebarCollapsed && (
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => navigate('/settings')}
              style={{ color: '#d4d4d4' }}
            />
          )}
```

确认 `SettingOutlined` 已在 Workspace 顶部 import（当前第 9 行已有），`navigate` 已可用（第 44 行）。无需新增 import。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "pages/Settings|pages/Workspace"`
Expected: 无输出。

- [ ] **Step 4: Lint**

Run: `npx eslint src/renderer/pages/Settings/index.tsx src/renderer/pages/Workspace/index.tsx`
Expected: 无 error。

- [ ] **Step 5: 手动冒烟**

Run: `npm run dev`，进入工作区。
1. 侧栏右上见齿轮按钮 → 点击 → 进入 `/settings` 页，显示 ThemeSettings（主题/字号/编辑器选项）。
2. 点字号 20px → 点返回箭头回工作区 → 编辑器字号已变 20px（即时生效）。
3. 切「显示行号」「自动换行」开关 → 返回工作区 → 编辑器相应变化。
4. 返回箭头回到工作区后，当前章节与编辑内容仍正常（history state 保留）。
5. 主题区「浅色」按钮仍为禁用（符合预期，超范围）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/pages/Settings/index.tsx src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(settings): 接线 Settings 页（渲染 ThemeSettings）+ 工作区齿轮入口

复活从未渲染的 ThemeSettings 死代码；/settings 孤儿路由补入口；
侧栏头部齿轮按钮 navigate('/settings')，设置页返回箭头 navigate(-1)。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 文档状态更新

**Files:**
- Modify: `docs/AUDIT.md`（追加 2026-08-02 复审段）
- Modify: `README.md`（进度表 + 已知限制，约 166-189 行）
- Modify: `docs/DEVELOPMENT.md`（总览表状态，约 15-34 行）

**Interfaces:** 无（纯文档）。

- [ ] **Step 1: AUDIT.md 追加复审段**

在 `docs/AUDIT.md` 顶部「## 2026-06-25 复审」段之后，插入新段：

```markdown
## 2026-08-02 复审：批次 1 稳定与打磨

分支 `feat/stability-and-polish`，详见 `docs/superpowers/plans/2026-08-02-stability-and-polish.md`。已修复：

- **切章数据丢失**（已知限制 1）：新增 `saveCurrentChapter({silent})` 集中 chokepoint；`selectChapter`/`handleBack` 切换前 flush；`beforeunload` 兜底；自动保存改静默 flush。函数式更新 + id 守卫防异步回写。残留：fire-and-forget 极窄竞态（手动 Ctrl+S 不受影响），可忽略。
- **Ctrl+1/2 切栏**（已知限制 2）：`useMenu` 增加 `characters`/`settings`/`wordCount`/`dailyStats` case，收起时展开。
- **Tab 右键菜单**（阶段 7 缺陷）：`EditorTabs` 用 `Dropdown trigger=contextMenu` 包裹，新增「关闭右侧」「关闭其他(以右键 target 为基准)」。
- **Settings 接线**（阶段 5 占位 + ThemeSettings 死代码）：`/settings` 渲染 ThemeSettings，侧栏齿轮入口，返回箭头。

仍待做：阶段 16 统计重做、阶段 17 导出实现、阶段 15 快捷键自定义（后续批次）。
```

- [ ] **Step 2: README.md 更新进度表与已知限制**

在 `README.md` 的「开发进度总览」表（约 168-188 行）：
- 阶段 5 行状态改为：`✅ 已实现（设置页已接线，渲染 ThemeSettings）`
- 阶段 7 行状态改为：`✅ 已实现（右键菜单已补：关闭/其他/右侧/全部）`
- 阶段 9 行保持 `⚠️ 部分`（本批未触及）

将表下「**真实进度**」段（约 189 行）的「已知限制」改为：

```markdown
**真实进度**: 端到端可用链路为「撰写正文 + 角色/设定 CRUD + 章节重命名 + 大纲导航 + 自动保存（静默）+ 菜单栏动作 + 编辑器设置（设置页可达）+ Tab 右键菜单 + 切章/返回/关窗自动 flush」。阶段 16（统计重做）、17（导出实现）、15（快捷键自定义）仍待做。
```

（删除原「切章时上一章未保存…」与「Ctrl+1/2 尚未切换」两条已修复限制。）

- [ ] **Step 3: DEVELOPMENT.md 更新总览表**

在 `docs/DEVELOPMENT.md` 总览表（约 15-34 行）将对应行状态改为与 README 一致：
- 阶段 5：`✅ 已实现`
- 阶段 7：`✅ 已实现`
（阶段 8/10/11/12/13/14/18 已在 06-25 标 ✅，保持。）

- [ ] **Step 4: 提交**

```bash
git add docs/AUDIT.md README.md docs/DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
docs: 更新进度（批次1 稳定与打磨完成）

AUDIT 追加 2026-08-02 复审段；README/DEVELOPMENT 阶段 5/7 标完成，
移除已修复的切章 flush / Ctrl+1/2 两条已知限制。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 收尾验证（全部 Task 完成后）

- [ ] Run: `npx tsc --noEmit` — 总错误数 ≤ 62（基线），无被改文件新错误。
- [ ] Run: `npm run lint` — 通过。
- [ ] Run: `npm run build` — 通过。
- [ ] 完整手动冒烟（合并各 Task 的冒烟步骤连续走一遍）。
- [ ] `git log --oneline feat/stability-and-polish ^main` — 确认 5 个提交（1 spec + 5 task；spec 已先提交）。

## 后续

本批完成后，按既定顺序进入**批次 2：导出功能（阶段 17）**，开新 spec → 计划 → 实现。合并 `feat/stability-and-polish` 到 main 的时机由用户决定（可用 superpowers:finishing-a-development-branch）。

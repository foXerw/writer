# 批次 1 设计：稳定与打磨（Stability & Polish）

> 日期: 2026-08-02
> 范围: 修复切章数据丢失 + Ctrl+1/2 菜单切换侧栏 + Tab 右键菜单 + Settings 页最小接线
> 依据: `docs/AUDIT.md` 已知限制 1/2，及 2026-08-02 代码复核确认的 4 项真实缺陷
> 关联: 总体规划见对话——本批是「4 批顺序推进」的第 1 批（后续：导出 / 统计 / 快捷键自定义）

---

## 背景与动机

经 2026-06-25 结构修复后，写作正文核心链路可用，但仍有 4 项缺陷影响数据安全与可达性：

1. **切章/返回/关窗时丢失未保存编辑**（≤30s 编辑可能丢失）——唯一正确性缺陷。
2. **Ctrl+1/2/3 菜单事件未切换侧栏 tab**——命中 `useMenu` 的 `default` 分支。
3. **Tab 右键菜单为空函数**——`EditorTabs.handleContextMenu` 仅 `e.preventDefault()`。
4. **Settings 页是孤儿路由 + ThemeSettings 是死代码**——`/settings` 无入口，`ThemeSettings` 从未渲染，导致字号/换行/行号**无任何 UI 入口可改**。

本批修复全部 4 项，不引入新功能特性，保持范围可控。

---

## 模块 1：切章数据丢失修复（核心）

### 根因（已复核 `src/renderer/pages/Workspace/index.tsx`）

- `selectChapter(chapter)`（约 133 行）直接 `setCurrentChapter` / `setEditorContent` / `setChapterTitle`，**不保存上一章**。
- 自动保存 effect（约 183 行）依赖 `currentChapter?.id`，切章时清理函数仅 `stopAutoSave()`——**只清 timer，不存盘**。
- `handleBack`（约 216 行）`navigate('/')` 前**不 flush**。
- 无 `beforeunload` / 应用退出处理。

### 方案：集中 chokepoint + beforeunload fire-and-forget

新增统一的存盘与 flush 入口，所有改变 `currentChapter` 的路径在切换前先保存上一章。

**改动（`pages/Workspace/index.tsx`）**：

- 新增 `saveCurrentChapter(opts?: { silent?: boolean }): Promise<void>`
  - 前置：`currentChapter` 与 `projectPath` 存在。
  - 若 `isDirtyRef.current === false`：直接返回（无脏数据不写）。
  - 调用 `updateChapter(projectPath, { ...currentChapter, title: chapterTitle, content: editorContent })`。
  - 成功：`setCurrentChapter(updated)`、同步 `chapters` 数组、`isDirtyRef.current = false`。
  - `silent === false`：`message.success('保存成功')`；`silent`（默认）：不弹 toast。
  - 失败：`message.error('保存失败')`（即使是 silent，失败需可见——数据安全问题优先于静默）。
- 重构 `handleSave` = `() => { void saveCurrentChapter({ silent: false }) }`。
- 新增 `flushIfDirty() = () => { void saveCurrentChapter({ silent: true }) }`。
- 改 `selectChapter(chapter)`：**先 `flushIfDirty()`（保存当前章），再** `setCurrentChapter` / `setEditorContent` / `setChapterTitle`。覆盖 open / switch / close-current 三条路径（它们都经 `selectChapter`）。
  - 初始加载 `loadChapters` 首次调用 `selectChapter` 时无 current、非 dirty，flush 为空操作，安全。
- 改 `handleBack`：`flushIfDirty()` 后 `navigate('/')`。
- 新增 `useEffect` 注册 `window` 的 `beforeunload`：调用 `flushIfDirty()`（fire-and-forget 异步 IPC，尽力而为）。switch/back 的显式 flush 是主要保障；beforeunload 为最后兜底。

### 竞态与边界

- `flushIfDirty` 为 fire-and-forget；连续快速切换可能产生在途请求。`isDirtyRef` 在首个 flush 成功后置 false，后续不会重复写同一内容。可接受。
- `handleDeleteChapter` 删除当前章时丢弃其未保存编辑——符合预期（章节已被删除）。
- 自动保存 effect 保留不动，作为周期性兜底（30s）。

---

## 模块 2：Ctrl+1/2/3 + 字数/今日写作 → 切换侧栏 tab

### 根因

`menu.ts` 已发送 `characters`（Ctrl+1）/`settings`（Ctrl+2，世界观设定）/`plot`（Ctrl+3）/`wordCount`/`dailyStats` 事件；Workspace `useMenu` handler 无对应 case，落入 `default`。

### 改动（`pages/Workspace/index.tsx` 的 `useMenu` handler）

新增 case：

| 事件 | 行为 |
|------|------|
| `'characters'` | `setSidebarTab('characters')`；若 `sidebarCollapsed` 则 `setSidebarCollapsed(false)` |
| `'settings'` | `setSidebarTab('settings')`；同上展开 |
| `'wordCount'` / `'dailyStats'` | `setSidebarTab('stats')`；同上展开（顺带接线，零成本一致性） |
| `'plot'` | 无对应面板，no-op（超范围，留注释说明） |

展开仅作用于 `sidebarCollapsed`；`focusMode` 隐藏侧栏是独立维度，不在此处理（用户退出专注后可见）。

---

## 模块 3：Tab 右键上下文菜单

### 根因

`EditorTabs.tsx` 的 `handleContextMenu`（约 148 行）为空 `e.preventDefault()`；组件内已有 `handleClose` / `handleCloseOthers` / `handleCloseAll` / `handleSwitchToNext` 但仅供左上角溢出菜单使用。

### 改动（`src/renderer/components/Layout/EditorTabs.tsx`）

- 删除 `handleContextMenu` 及其 `onContextMenu` 绑定。
- 新增 `handleCloseRight(targetId: string)`：关闭 `chapters` 中排在 `targetId` 之后的所有 tab（不含 target）。
- 在 `items` 的 map 中，将每个 chapter 的 `label` 包裹：

  ```tsx
  <Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems(chapter) }}>
    <span ...>{原有 label}</span>
  </Dropdown>
  ```

- `contextMenuItems(chapter): MenuProps['items']` 闭包捕获该 chapter，返回：
  - 关闭 → `handleClose(chapter.id)`
  - 关闭其他 → `handleCloseOthersThan(chapter.id)`（以**右键 target** 为基准）
  - 关闭右侧 → `handleCloseRight(chapter.id)`
  - 关闭全部 → `handleCloseAll()`

### Note

现有 `handleCloseOthers` 基于 `currentChapter`（激活 tab）而非右键 target。为避免「右键 tab A 却以激活 tab 为基准」的歧义，**右键菜单的「关闭其他」改以右键 target 为基准**：新增 `handleCloseOthersThan(targetId)`（关闭除 target 外所有 tab）。原 `handleCloseOthers` 保留给左上角溢出菜单（以激活 tab 为基准）。新增 `handleCloseRight(targetId)`（关闭 target 之后的 tab，不含 target）。

---

## 模块 4：Settings 页最小接线

### 根因

- `/settings` 路由存在（`App.tsx:18`）但**全项目无 `navigate('/settings')`**，孤儿路由。
- `ThemeSettings` 组件（字号/换行/行号设置 UI）**从未渲染**，死代码——用户当前无任何入口修改编辑器外观（尽管值已能流入编辑器）。

### 改动

**`src/renderer/pages/Settings/index.tsx`**（重写占位内容）：

- 顶部 Header：返回箭头（`useNavigate()` + `navigate(-1)`，保留 history state 回工作区）+ 标题「设置」。
- 主体渲染 `<ThemeSettings />`（不改其内部；浅色按钮维持禁用）。

**`src/renderer/pages/Workspace/index.tsx`**（加入口）：

- 侧栏头部（项目名 / 返回首页按钮旁）新增齿轮按钮（`SettingOutlined`）→ `navigate('/settings')`。

### 边界

- `navigate(-1)` 依赖 history stack；从工作区进入设置再返回，state 完整。直接刷新 `/settings` 会丢 state（既有限制，不在本批范围）。
- 不实现浅色主题、不改 ThemeSettings 内部布局。

---

## 范围外（明确不做）

- 浅色主题启用（phase 18 既有遗留）。
- `plot`（情节）面板（无对应组件）。
- 自动保存开关/间隔配置 UI（用户选择「最小接线」，留待后续）。
- `useMenu` 内联 handler 每次渲染重订阅的性能优化（影响可忽略，AUDIT 已知限制 3）。
- 引入单元测试框架。

---

## 测试与验证

无测试框架。验证组合：

1. `npx tsc --noEmit`——不新增类型错误（基线 62 个既有错误，对比 `docs/superpowers/specs/tsc-baseline.txt` 不增长）。
2. `npm run lint`——通过。
3. `npm run build`——通过。
4. 手动冒烟矩阵（`npm run dev`）：
   - **数据安全**：编辑 <30s 立刻切章 → 切回，内容在；编辑后点返回首页 → 重进项目，内容在；编辑后直接关窗 → 重开，内容在。
   - **菜单切栏**：Ctrl+1→角色、Ctrl+2→设定、Ctrl+Shift+W/D→统计，且侧栏收起时自动展开。
   - **Tab 右键**：右键 tab 出现菜单；关闭/关闭其他/关闭右侧/关闭全部均按预期生效。
   - **设置入口**：齿轮按钮进 `/settings`；改字号即时反映到编辑器；返回箭头回到工作区且章节状态正常。
   - **回归**：Ctrl+S 保存仍弹 toast；30s autosave 仍工作；专注/打字机/大纲不受影响。

---

## 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `src/renderer/pages/Workspace/index.tsx` | 核心：flush 机制 + 菜单切栏 case + 设置入口齿轮按钮 |
| `src/renderer/components/Layout/EditorTabs.tsx` | Tab 右键菜单（包裹 Dropdown + handleCloseRight + handleCloseOthersThan） |
| `src/renderer/pages/Settings/index.tsx` | 占位 → 渲染 ThemeSettings + Header 返回 |
| `docs/AUDIT.md` / `README.md` / `docs/DEVELOPMENT.md` | 状态更新（完成后） |

预计代码改动量：3 个源文件，约 80–120 行净增。

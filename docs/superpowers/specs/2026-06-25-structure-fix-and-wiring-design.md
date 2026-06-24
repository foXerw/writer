# 结构修复 + 死代码接线 设计文档

> 日期: 2026-06-25
> 范围: 依据 `docs/AUDIT.md` 优先级 1（结构修复）+ 优先级 2（死代码接线）
> 目标: 让阶段 8/10/11/12/13 从「空壳/半成品」变为端到端可用，并修掉菜单 IPC 与 preload 类型两个结构性断点。

---

## 1. 背景与现状

经审计（`docs/AUDIT.md`），当前真正端到端可用的仅「撰写正文」链路。本设计覆盖的「部分完成/空壳」项及其根因：

| 阶段 | 组件 | 根因 |
|------|------|------|
| 菜单 IPC（结构性） | `electron/main/menu.ts`、`electron/preload/index.ts`、`hooks/useMenu.ts` | menu.ts 发 20 个 `menu:<event>` 通道，preload 未暴露任何 `menu:*` 监听；`useMenu` 调 `window.novelWriter.on[event]` 全为 `undefined`，且 Workspace 从未调用 `useMenu` |
| preload 类型（结构性） | `electron/preload/index.ts` | `NovelWriterAPI` 与 `Window.novelWriter` 中 `character`/`setting` 返回类型被错写成 `Chapter` |
| 阶段 8 自动保存 | `services/ipcService.ts`（`startAutoSave`）、`pages/Workspace` | `startAutoSave`/`stopAutoSave` 已定义但全项目零调用 |
| 阶段 10 重命名 | `components/Explorer/ChapterTree.tsx` | `showRenameModal.onOk` 只改局部变量并弹成功提示，从不调 `renameChapter` |
| 阶段 11 大纲 | `components/Editor/OutlineView.tsx`、`pages/Workspace` | OutlineView 已编写但从未渲染；MonacoEditor 无对外 `revealLineInCenter` 入口 |
| 阶段 12 角色 | `components/Explorer/CharacterPanel.tsx` | 误用 `useChapter`，`loadCharacters` 调 `getAllChapters` 后 `setCharacters([])`；`handleSave` 从不调 IPC；缺 tags 字段 |
| 阶段 13 设定 | `components/Explorer/SettingPanel.tsx` | `loadSettings` 硬置 `[]`；`handleSave`/`handleDelete` 只弹提示从不调 IPC |
| 阶段 18 设置未接编辑器 | `components/Settings/ThemeSettings.tsx`、`pages/Workspace`、`MonacoEditor` | 字号/换行/行号写入 store 但 Workspace 不读、不传；MonacoEditor `wordWrap:'on'`、`lineNumbers:'off'` 硬编码 |
| 阶段 14 专注模式 | `pages/Workspace` | `focusMode` 不隐藏侧栏 |

后端 `character:*`/`setting:*`/`chapter:rename` 处理器均已完整实现，本轮只接前端。

---

## 2. 结构性修复

### 2.1 菜单 IPC 桥接

**方案：单一 `menu:event` 通道。**

- `electron/main/menu.ts` 与 `electron/main/tray.ts` 中所有
  `win.webContents.send('menu:<event>'[, payload])`
  改为
  `win.webContents.send('menu:event', '<event>', payload)`。
  其中 `focusMode`/`typewriterMode` 的 payload 为 `menuItem.checked` 布尔，保留。
- `electron/preload/index.ts` 新增 `menu` 命名空间：
  ```ts
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => () => void
  }
  ```
  实现订阅 `menu:event`，返回真正的 unsubscribe（`ipcRenderer.removeListener`）。
- `hooks/useMenu.ts` 重写：`useMenu(handler)` 改为一次性 `window.novelWriter.menu.onEvent((event, ...args) => handler(event as MenuEvent, ...args))`，返回 unsub 在 cleanup 调用。`MenuEventHandler` 签名改为 `(event: MenuEvent, ...args: unknown[]) => void`。`useMenuEvent` 同步调整。
- `pages/Workspace/index.tsx` 接入 `useMenu`，按 event 分发：
  - `newChapter` → `handleCreateChapter`
  - `save` → `handleSave`
  - `focusMode` → `setFocusMode(payload as boolean)`
  - `typewriterMode` → `setTypewriterMode(payload as boolean)`
  - `toggleOutline` → 切换大纲面板显隐
  - `toggleChapterTree` → 切换侧栏
  - `export`/`newProject`/`wordCount`/`dailyStats` 等 → 暂留 `console.log` 或轻提示（本轮不实现导出/统计）
- 在 `common/ipc.ts` 的 `MainToRendererEvents` 增补 `'menu:event': (event: string, ...args: unknown[]) => void`，保持类型闭环。

**取舍：** 该方案需机械改 ~22 处 `send`，但换来单一监听器、干净 unsub、未来加菜单项零成本。备选「保留每通道 + preload 枚举订阅」会重复维护通道列表且 `removeAllListeners` 过粗，不采用。

### 2.2 preload 类型错误 + 缺失 hooks

- `electron/preload/index.ts`：`NovelWriterAPI` 类型与 `Window.novelWriter` 全局声明中，`character` 块返回类型由 `Chapter` 改为 `Character`，`setting` 块由 `Chapter` 改为 `Setting`。需在文件顶部 import `Character`、`Setting`。
- `hooks/useIPC.ts`：
  - `IPCAPI` 接口补 `character`、`setting` 两个命名空间（签名对齐 `RendererToMainRequests`）。
  - 新增 `useCharacter()` hook：`getAllCharacters`、`getCharacterById`、`createCharacter`、`updateCharacter`、`deleteCharacter`。
  - 新增 `useSetting()` hook：`getAllSettings`、`getSettingById`、`createSetting`、`updateSetting`、`deleteSetting`。
  - 写法对齐已有 `useChapter()`。

---

## 3. 死代码接线

### 3.1 角色面板（阶段 12） — `CharacterPanel.tsx`

- 将 `useChapter()` 替换为 `useCharacter()`。
- `loadCharacters`：`const list = await getAllCharacters(projectPath); setCharacters(list)`。
- `handleSave`：
  - 编辑态：`await updateCharacter(projectPath, { ...editingCharacter, ...values, tags: values.tags ?? [] })`
  - 新建态：`await createCharacter(projectPath, { ...values })`
  - 成功后 `setModalVisible(false)` + `loadCharacters()`；失败 `messageApi.error`。
- `handleDelete`：由 `window.electronAPI.invoke('character:delete', ...)` 改为 `deleteCharacter(projectPath, characterId)`。
- 表单补 `tags` 字段（`Select mode="tags"`），`handleEdit` 回填 `tags: character.tags`，保存时并入 values。

### 3.2 世界观面板（阶段 13） — `SettingPanel.tsx`

- 引入 `useSetting()`。
- `loadSettings`：`const list = await getAllSettings(projectPath); setSettings(list)`。
- `handleSave`：
  - 编辑态：`updateSetting(projectPath, { ...editingSetting, ...values })`
  - 新建态：`createSetting(projectPath, { ...values })`
  - 成功后关弹窗 + `loadSettings()`。
- `handleDelete`：`await deleteSetting(projectPath, settingId)`，成功后 `loadSettings()`。

### 3.3 章节重命名（阶段 10） — `ChapterTree.tsx`

- `showRenameModal` 的 `onOk`：
  ```ts
  if (newTitle.trim() && newTitle !== chapter.title) {
    try { await renameChapter(projectPath, chapter.id, newTitle.trim()); messageApi.success('已重命名'); onChapterChange(); }
    catch { messageApi.error('重命名失败') }
  }
  ```
  从 `useChapter()` 解构出 `renameChapter`。
- `copyChapter` 改为 `messageApi.info('复制章节功能暂未实现')`，不再弹假成功。本轮不做复制后端。

### 3.4 大纲视图（阶段 11）

- `MonacoEditor.tsx`：改为 `forwardRef` 组件，`useImperativeHandle` 暴露
  ```ts
  { revealLineInCenter: (lineNumber: number) => void }
  ```
  内部调 `editorRef.current?.revealLineInCenter(lineNumber)`。导出 `MonacoEditorHandle` 类型。
- `pages/Workspace/index.tsx`：
  - `const editorRef = useRef<MonacoEditorHandle>(null)`，传给 `<MonacoEditor ref={editorRef} ... />`。
  - 新增大纲面板状态 `outlineVisible`（默认 false），渲染 `<OutlineView content={editorContent} onNavigateToLine={(ln) => editorRef.current?.revealLineInCenter(ln)} />`。
  - 面板形态：在主内容区右侧放可折叠 Sider/抽屉；`outlineVisible` 为 false 时不渲染。
  - `menu:toggleOutline` 与键盘 `Ctrl+Shift+O`（在 `useKeyboard` 已有则复用，否则在 Workspace 加监听）切换显隐。

### 3.5 自动保存（阶段 8） — Workspace 接线

- Workspace 引入 `startAutoSave`/`stopAutoSave`（来自 `services/ipcService`）。
- 新增 `isDirty` 状态：`setEditorContent` 包装一层，内容变化时置 `isDirty=true`；`handleSave` 成功后置 `isDirty=false`。
- `useEffect`：当 `currentChapter` 存在时 `startAutoSave({ interval: autoSaveInterval, onSave: () => { if (isDirty) handleSave(); return editorContent } })`；依赖项 `[currentChapter?.id]`，切章/卸载时 `stopAutoSave()`。
  - 注意闭包：`onSave` 内需读最新 `isDirty`/`editorContent`，用 ref 持有最新值避免定时器读到旧值。
- `autoSaveInterval` 来源：Home 从 `openProject`/`createProject` 返回的 `ProjectData.config.autoSaveInterval` 透传到 Workspace（`location.state` 增 `config`）；缺失时默认 `30000`。`config.autoSave === false` 时不启动自动保存。
- 同步：Home 的 `navigate('/workspace', { state: {...} })` 三处补 `config`。

---

## 4. 附带小接线（已写设置未接编辑器，廉价，并入本轮）

### 4.1 字号/换行/行号 → MonacoEditor

- `pages/Workspace`：从 `useEditorStore()` 读 `fontSize`、`wordWrap`、`showLineNumbers`，传入 `<MonacoEditor>`。
- `MonacoEditor.tsx`：
  - 新增 props `wordWrap?: boolean`（默认 true）、`showLineNumbers?: boolean`（默认 false 以保持现状视觉）。
  - 创建编辑器时 `wordWrap: wordWrap ? 'on' : 'off'`、`lineNumbers: showLineNumbers ? 'on' : 'off'`。
  - 新增 effect：`wordWrap`/`showLineNumbers` 变化时 `editor.updateOptions(...)`。

### 4.2 专注模式隐藏侧栏

- `pages/Workspace`：`focusMode` 为 true 时强制 `sidebarCollapsed=true`（或单独条件隐藏 Sider）。退出专注模式时不自动展开（保持用户上次状态），即只做「进入时收起」。

---

## 5. 本轮明确不做（避免范围蔓延）

- 阶段 17 导出（需引入 docx/epub/pdf 库，单独一轮）
- 阶段 16 统计重做（时长计时 + 图表，单独一轮）
- 阶段 15 快捷键冲突检测/自定义
- Settings 页面功能化（仍是占位）
- 章节状态修改入口（后端硬编码 draft）
- 章节复制后端实现

---

## 6. 验证

1. **类型与构建**：`npm run build`（electron-vite 三段编译 + tsc）必须通过。本轮大量改类型，类型检查是第一道关。
2. **手动走查**（`npm run dev`）：
   - 新建项目 → 建章节写作 → 菜单栏「新建章节/保存/专注模式/大纲」生效。
   - 角色增删改 → 重开项目仍在（持久化到 `characters/*.json`）。
   - 设定增删改 → 重开项目仍在（持久化到 `settings/<category>/*.json`）。
   - 章节右键重命名 → 文件名与首行标题更新。
   - 改字号 → 编辑器即时反映。
   - 大纲面板点击标题 → 编辑器滚动到对应行。
   - 30s 自动保存 → 修改后等待，关闭再重开内容仍在。

---

## 7. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `electron/main/menu.ts` | `send` 调用改为单一 `menu:event` 通道 |
| `electron/main/tray.ts` | 同上（2 处） |
| `electron/preload/index.ts` | 新增 `menu.onEvent`；修正 `character`/`setting` 类型；import `Character`/`Setting` |
| `src/common/ipc.ts` | `MainToRendererEvents` 增 `menu:event` |
| `src/renderer/hooks/useMenu.ts` | 重写为订阅 `menu:event`；handler 签名带 payload |
| `src/renderer/hooks/useIPC.ts` | `IPCAPI` 补 character/setting；新增 `useCharacter`/`useSetting` |
| `src/renderer/components/Explorer/CharacterPanel.tsx` | 换 hook、接线 load/save/delete、补 tags |
| `src/renderer/components/Explorer/SettingPanel.tsx` | 接线 load/save/delete |
| `src/renderer/components/Explorer/ChapterTree.tsx` | 重命名接 `renameChapter`；copyChapter 改提示 |
| `src/renderer/components/Editor/MonacoEditor.tsx` | `forwardRef` 暴露 `revealLineInCenter`；补 wordWrap/showLineNumbers props/effect |
| `src/renderer/components/Editor/OutlineView.tsx` | 无需改（已可用） |
| `src/renderer/pages/Workspace/index.tsx` | 接入 `useMenu`、大纲面板、自动保存、字号/换行/行号 props、专注模式收起侧栏 |
| `src/renderer/pages/Home/index.tsx` | navigate state 透传 `config` |

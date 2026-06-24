# 结构修复 + 死代码接线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉菜单 IPC 桥接与 preload 类型两个结构性断点，并接线角色/设定/重命名/大纲/自动保存等死代码，使阶段 8/10/11/12/13 端到端可用。

**Architecture:** 单一 `menu:event` 通道贯通菜单→preload→useMenu→Workspace；新增 `useCharacter`/`useSetting` 类型安全 hooks 对接已就绪的后端处理器；MonacoEditor 用 forwardRef 暴露 `revealLineInCenter` 供大纲导航；Workspace 接线自动保存（ref 闭包）与编辑器设置 props。

**Tech Stack:** Electron 28 / React 18 / TypeScript 5.3 (strict) / electron-vite 2 (esbuild) / Ant Design 5 / Zustand / Monaco Editor.

## Global Constraints

- **硬性验证门 = `npm run build`**（electron-vite 三段编译，exit 0）。每个任务结束必须通过此门并提交。`npm run build` 使用 esbuild，**不做类型检查**，但会捕获语法与 import 解析回归。
- **类型检查（咨询性，非硬门）：** `npx tsc --noEmit` 当前有约 130 个**既有**错误（多为 `import type` 路径、未用变量、无效 Electron role），esbuild 在运行时剥离了类型 import 故 app 仍可运行。本计划**不**修复全部既有错误（超出范围）。要求：你的改动**不得新增** tsc 错误数；你**重写**的文件应变得 tsc 干净（自然修复其中的既有错误）。Task 0 建立 tsc baseline 以便对比。
- `tsconfig.json` 已开 `strict` + `noUnusedLocals` + `noUnusedParameters`：你新增/重写的代码不得有未用变量/参数。
- 路径别名：renderer 代码用 `@/common/ipc`（已在 `useIPC.ts` 验证可解析）；不要新引入 `../../common/ipc` 这类已被 tsc 标错的相对路径。
- 频繁提交，每个任务一个 commit，消息以 `feat:`/`fix:`/`refactor:` 前缀。
- 本轮不做：导出、统计重做、快捷键冲突检测、Settings 页功能化、章节状态修改入口、章节复制后端。

---

### Task 0: 建立 tsc baseline（咨询性门）

**Files:**
- Modify: `tsconfig.json:32`

**Why:** `npx tsc --noEmit` 当前因 `include` 过宽（匹配到被引用项目拥有的 `*.config.ts`）报 TS6305 噪声，无法运行。收窄 include 让 tsc 可跑，作为后续咨询性对比门。

- [ ] **Step 1: 收窄 tsconfig include**

将 `tsconfig.json` 第 32 行：
```json
  "include": ["src", "electron", "**/*.ts", "**/*.tsx", "*.config.ts"],
```
改为：
```json
  "include": ["src", "electron"],
```
（`vite.config.ts`/`electron.vite.config.ts` 由 `tsconfig.node.json` 覆盖，无需在根 include；electron-vite 构建不依赖此 include，安全。）

- [ ] **Step 2: 生成 baseline**

Run: `npx tsc --noEmit > docs/superpowers/specs/tsc-baseline.txt 2>&1; echo $?`
Expected: 退出码非 0（既有错误），生成 baseline 文件。记录错误总数：
`grep -c "error TS" docs/superpowers/specs/tsc-baseline.txt`

- [ ] **Step 3: 确认构建仍通过**

Run: `npm run build`
Expected: exit 0，`✓ built in ...s`

- [ ] **Step 4: 提交**

```bash
git add tsconfig.json docs/superpowers/specs/tsc-baseline.txt
git commit -m "chore: 收窄 tsconfig include 并建立 tsc baseline"
```

---

### Task 1: ipc.ts `menu:event` 类型 + preload 暴露 `menu.onEvent` 与修正 character/setting 类型

**Files:**
- Modify: `src/common/ipc.ts:4-9`
- Modify: `electron/preload/index.ts` (imports, 运行时 menu 块, `NovelWriterAPI` 类型, `Window` 全局声明)

**Interfaces:**
- Produces: `window.novelWriter.menu.onEvent(handler: (event: string, ...args: unknown[]) => void) => () => void`；`MainToRendererEvents['menu:event']`；`NovelWriterAPI.character` 返回 `Character`、`NovelWriterAPI.setting` 返回 `Setting`。

- [ ] **Step 1: ipc.ts 增 menu:event 事件类型**

在 `src/common/ipc.ts` 的 `MainToRendererEvents`（第 4-9 行）末尾 `'stats:updated'` 后加一行：
```ts
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
  'menu:event': (event: string, ...args: unknown[]) => void
}
```

- [ ] **Step 2: preload 修正 import 路径并引入 Character/Setting 与 IpcRendererEvent**

`electron/preload/index.ts` 第 1 行：
```ts
import { contextBridge, ipcRenderer } from 'electron'
```
改为：
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
```
第 2-10 行 import 块：
```ts
import {
  MainToRendererEvents,
  RendererToMainRequests,
  ProjectData,
  Chapter,
  RecentProject,
  WritingStats,
  ProjectType
} from '../src/common/ipc'
```
改为（修正路径 `../src` → `../../src`，并加 `Character`、`Setting`）：
```ts
import {
  MainToRendererEvents,
  RendererToMainRequests,
  ProjectData,
  Chapter,
  Character,
  Setting,
  RecentProject,
  WritingStats,
  ProjectType
} from '../../src/common/ipc'
```

- [ ] **Step 3: preload 运行时暴露 menu.onEvent**

在 `contextBridge.exposeInMainWorld('novelWriter', { ... })` 内、`on: { ... }` 块**之后**（即 `on` 块的闭合 `}` 之后、对象闭合 `}` 之前）新增：
```ts
  // 菜单事件
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => {
      const listener = (_e: IpcRendererEvent, event: string, ...args: unknown[]) => handler(event, ...args)
      ipcRenderer.on('menu:event', listener)
      return () => {
        ipcRenderer.removeListener('menu:event', listener)
      }
    }
  }
```

- [ ] **Step 4: preload 修正 `NovelWriterAPI` 类型中 character/setting 并加 menu**

将 `NovelWriterAPI` 类型（约 150-163 行）的 `character` 块：
```ts
  character: {
    getAll: (projectPath: string) => Promise<Chapter[]>
    getById: (params: { projectPath: string; characterId: string }) => Promise<Chapter | null>
    create: (params: { projectPath: string; character: Partial<Chapter> }) => Promise<Chapter>
    update: (params: { projectPath: string; character: Chapter }) => Promise<Chapter>
    delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
  }
```
改为：
```ts
  character: {
    getAll: (projectPath: string) => Promise<Character[]>
    getById: (params: { projectPath: string; characterId: string }) => Promise<Character | null>
    create: (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
    update: (params: { projectPath: string; character: Character }) => Promise<Character>
    delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
  }
```
将紧随的 `setting` 块：
```ts
  setting: {
    getAll: (projectPath: string) => Promise<Chapter[]>
    getById: (params: { projectPath: string; settingId: string }) => Promise<Chapter | null>
    create: (params: { projectPath: string; setting: Partial<Chapter> }) => Promise<Chapter>
    update: (params: { projectPath: string; setting: Chapter }) => Promise<Chapter>
    delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
  }
```
改为：
```ts
  setting: {
    getAll: (projectPath: string) => Promise<Setting[]>
    getById: (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
    create: (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
    update: (params: { projectPath: string; setting: Setting }) => Promise<Setting>
    delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
  }
```
在 `NovelWriterAPI` 的 `on: { ... }` 块之后加：
```ts
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => () => void
  }
```

- [ ] **Step 5: preload 修正 `Window` 全局声明（同步 Step 4 改动）**

`declare global { interface Window { novelWriter: { ... } } }` 中的 `character`、`setting` 块同 Step 4 改 `Chapter`→`Character` / `Setting`，并在其 `on: {...}` 块之后加同样的 `menu` 块。

- [ ] **Step 6: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 7: 提交**

```bash
git add src/common/ipc.ts electron/preload/index.ts
git commit -m "feat(ipc): 暴露 menu.onEvent 通道并修正 character/setting 类型"
```

---

### Task 2: menu.ts/tray.ts 改单一 `menu:event` 通道 + 修正无效 role

**Files:**
- Modify: `electron/main/menu.ts` (imports, 新增 sendMenu helper, 全部 click, 无效 role)
- Modify: `electron/main/tray.ts` (2 处 send)

**Interfaces:**
- Consumes: Task 1 的 `menu:event` 通道。
- Produces: 主进程对所有菜单动作发送 `win.webContents.send('menu:event', '<event>'[, payload])`。

- [ ] **Step 1: menu.ts 删除未用 import 并新增 sendMenu helper**

第 2 行 `import { createSettingsWindow } from './window'`（tsc 标未用）删除。在 `interface MenuOptions { ... }` **之前**新增：
```ts
// 统一发送菜单事件到渲染进程
function sendMenu(event: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send('menu:event', event, ...args)
  }
}
```

- [ ] **Step 2: menu.ts 全部 click 改用 sendMenu**

将每个形如：
```ts
          click: () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) {
              win.webContents.send('menu:<event>')
            }
          }
```
替换为：
```ts
          click: () => sendMenu('<event>')
```
事件名逐项为：`newProject`、`newChapter`、`save`、`saveAs`、`find`、`replace`、`toggleOutline`、`toggleChapterTree`、`prevChapter`、`nextChapter`、`wordCount`、`dailyStats`、`characters`、`settings`、`plot`、`export`、`shortcuts`、`about`。

对 `focusMode`/`typewriterMode`（带 `menuItem.checked`）：
```ts
          click: (menuItem) => sendMenu('focusMode', menuItem.checked)
```
```ts
          click: (menuItem) => sendMenu('typewriterMode', menuItem.checked)
```

- [ ] **Step 3: menu.ts 修正无效 role**

将第 57 行 `{ role: 'openFile' as const }` 改为：
```ts
          { label: '打开文件', click: () => sendMenu('openFile') },
```
将第 58 行 `{ role: 'openRecent' as const, enabled: false }` 改为：
```ts
          { label: '最近打开', enabled: false },
```
将第 80 行 `{ role: 'saveAll' as const, enabled: false }` 改为：
```ts
          { label: '保存全部', enabled: false },
```
将第 82 行：
```ts
        ...(isMac ? [{ role: 'closeWindow' as const }] : [{ role: 'quit' as const }])
```
改为：
```ts
        ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }])
```

- [ ] **Step 4: tray.ts 改 send**

`electron/main/tray.ts` 中两处 `win.webContents.send('menu:newChapter')` 改为：
```ts
            win.webContents.send('menu:event', 'newChapter')
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: 提交**

```bash
git add electron/main/menu.ts electron/main/tray.ts
git commit -m "refactor(menu): 统一 menu:event 单通道并修正无效 role"
```

---

### Task 3: 重写 useMenu + useIPC 新增 useCharacter/useSetting

**Files:**
- Modify (全量替换): `src/renderer/hooks/useMenu.ts`
- Modify: `src/renderer/hooks/useIPC.ts` (IPCAPI 接口, imports, 新增两个 hook)

**Interfaces:**
- Consumes: Task 1 的 `window.novelWriter.menu.onEvent`、`window.novelWriter.character`/`.setting`。
- Produces: `useMenu(handler: MenuEventHandler)`；`useCharacter()` → `{ getAllCharacters, getCharacterById, createCharacter, updateCharacter, deleteCharacter }`；`useSetting()` → `{ getAllSettings, getSettingById, createSetting, updateSetting, deleteSetting }`。

- [ ] **Step 1: 全量替换 useMenu.ts**

将 `src/renderer/hooks/useMenu.ts` 全部内容替换为：
```ts
import { useEffect, useCallback } from 'react'

export type MenuEvent =
  | 'newProject' | 'newChapter' | 'save' | 'saveAs' | 'find' | 'replace'
  | 'toggleOutline' | 'toggleChapterTree' | 'focusMode' | 'typewriterMode'
  | 'prevChapter' | 'nextChapter' | 'wordCount' | 'dailyStats'
  | 'characters' | 'settings' | 'plot' | 'export' | 'shortcuts' | 'about'
  | 'openFile' | 'openRecent' | 'saveAll'

export interface MenuEventHandler {
  (event: MenuEvent, ...args: unknown[]): void
}

// 菜单 Hook：订阅主进程 menu:event 通道
export function useMenu(handler: MenuEventHandler) {
  useEffect(() => {
    const unsub = window.novelWriter?.menu?.onEvent((event, ...args) =>
      handler(event as MenuEvent, ...args)
    )
    return () => {
      if (unsub) unsub()
    }
  }, [handler])
}

// 便捷 Hook：监听单个菜单事件
export function useMenuEvent(event: MenuEvent, callback: (...args: unknown[]) => void) {
  const handler = useCallback(
    (e: MenuEvent, ...args: unknown[]) => {
      if (e === event) {
        callback(...args)
      }
    },
    [event, callback]
  )
  useMenu(handler)
}
```

- [ ] **Step 2: useIPC.ts 引入 Character/Setting 类型**

第 2 行：
```ts
import type { ProjectData, Chapter, RecentProject, ProjectType } from '@/common/ipc'
```
改为：
```ts
import type { ProjectData, Chapter, Character, Setting, RecentProject, ProjectType } from '@/common/ipc'
```

- [ ] **Step 3: useIPC.ts IPCAPI 接口补 character/setting**

在 `IPCAPI` 接口的 `chapter: { ... }` 块之后、`dialog: { ... }` 之前插入：
```ts
  character: {
    getAll: (projectPath: string) => Promise<Character[]>
    getById: (params: { projectPath: string; characterId: string }) => Promise<Character | null>
    create: (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
    update: (params: { projectPath: string; character: Character }) => Promise<Character>
    delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
  }
  setting: {
    getAll: (projectPath: string) => Promise<Setting[]>
    getById: (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
    create: (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
    update: (params: { projectPath: string; setting: Setting }) => Promise<Setting>
    delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
  }
```

- [ ] **Step 4: useIPC.ts 新增 useCharacter / useSetting**

在 `useChapter()` 之后、`useDialog()` 之前新增：
```ts
// 角色相关 Hook
export function useCharacter() {
  const ipc = getIPC()

  const getAllCharacters = useCallback(async (projectPath: string): Promise<Character[]> => {
    return ipc.character.getAll(projectPath)
  }, [ipc])

  const getCharacterById = useCallback(async (
    projectPath: string,
    characterId: string
  ): Promise<Character | null> => {
    return ipc.character.getById({ projectPath, characterId })
  }, [ipc])

  const createCharacter = useCallback(async (
    projectPath: string,
    character: Partial<Character>
  ): Promise<Character> => {
    return ipc.character.create({ projectPath, character })
  }, [ipc])

  const updateCharacter = useCallback(async (
    projectPath: string,
    character: Character
  ): Promise<Character> => {
    return ipc.character.update({ projectPath, character })
  }, [ipc])

  const deleteCharacter = useCallback(async (
    projectPath: string,
    characterId: string
  ): Promise<boolean> => {
    return ipc.character.delete({ projectPath, characterId })
  }, [ipc])

  return {
    getAllCharacters,
    getCharacterById,
    createCharacter,
    updateCharacter,
    deleteCharacter
  }
}

// 世界观设定相关 Hook
export function useSetting() {
  const ipc = getIPC()

  const getAllSettings = useCallback(async (projectPath: string): Promise<Setting[]> => {
    return ipc.setting.getAll(projectPath)
  }, [ipc])

  const getSettingById = useCallback(async (
    projectPath: string,
    settingId: string
  ): Promise<Setting | null> => {
    return ipc.setting.getById({ projectPath, settingId })
  }, [ipc])

  const createSetting = useCallback(async (
    projectPath: string,
    setting: Partial<Setting>
  ): Promise<Setting> => {
    return ipc.setting.create({ projectPath, setting })
  }, [ipc])

  const updateSetting = useCallback(async (
    projectPath: string,
    setting: Setting
  ): Promise<Setting> => {
    return ipc.setting.update({ projectPath, setting })
  }, [ipc])

  const deleteSetting = useCallback(async (
    projectPath: string,
    settingId: string
  ): Promise<boolean> => {
    return ipc.setting.delete({ projectPath, settingId })
  }, [ipc])

  return {
    getAllSettings,
    getSettingById,
    createSetting,
    updateSetting,
    deleteSetting
  }
}
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: 提交**

```bash
git add src/renderer/hooks/useMenu.ts src/renderer/hooks/useIPC.ts
git commit -m "feat(hooks): 重写 useMenu 订阅 menu:event，新增 useCharacter/useSetting"
```

---

### Task 4: 角色面板接线（阶段 12）

**Files:**
- Modify: `src/renderer/components/Explorer/CharacterPanel.tsx`

**Interfaces:**
- Consumes: Task 3 的 `useCharacter()`。
- Produces: 角色增删改持久化到 `characters/*.json`。

- [ ] **Step 1: 换 hook**

第 29 行：
```ts
import { useChapter } from '../../hooks/useIPC'
```
改为：
```ts
import { useCharacter } from '../../hooks/useIPC'
```
第 43 行：
```ts
  const { getAllChapters, createChapter, updateChapter, deleteChapter } = useChapter()
```
改为：
```ts
  const { getAllCharacters, createCharacter, updateCharacter, deleteCharacter } = useCharacter()
```

- [ ] **Step 2: loadCharacters 用正确 API**

将 `loadCharacters`（52-63 行）替换为：
```ts
  const loadCharacters = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getAllCharacters(projectPath)
      setCharacters(list)
    } catch (error) {
      console.error('加载角色失败:', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath, getAllCharacters])
```

- [ ] **Step 3: handleEdit 回填 tags**

在 `handleEdit` 的 `form.setFieldsValue({ ... })` 中，`notes: character.notes` 之后加一行：
```ts
      tags: character.tags
```

- [ ] **Step 4: handleSave 接 IPC**

将 `handleSave`（95-112 行）替换为：
```ts
  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        name: values.name,
        gender: values.gender,
        age: values.age,
        role: values.role,
        appearance: values.appearance,
        personality: values.personality,
        background: values.background,
        goals: values.goals,
        flaws: values.flaws,
        notes: values.notes,
        tags: values.tags ?? []
      }
      if (editingCharacter) {
        await updateCharacter(projectPath, { ...editingCharacter, ...payload })
        messageApi.success('角色已更新')
      } else {
        await createCharacter(projectPath, payload)
        messageApi.success('角色已创建')
      }
      setModalVisible(false)
      loadCharacters()
    } catch (error) {
      messageApi.error('保存失败')
    }
  }
```

- [ ] **Step 5: handleDelete 用类型安全 hook**

将 `handleDelete`（115-123 行）替换为：
```ts
  const handleDelete = async (characterId: string) => {
    try {
      await deleteCharacter(projectPath, characterId)
      messageApi.success('角色已删除')
      loadCharacters()
    } catch (error) {
      messageApi.error('删除失败')
    }
  }
```

- [ ] **Step 6: 表单补 tags 字段**

在编辑弹窗 `<Form>` 内、`notes` 的 `Form.Item` 之后、`</Form>` 之前加：
```tsx
            <Form.Item name="tags" label="标签">
              <Select mode="tags" placeholder="添加标签" style={{ width: '100%' }} />
            </Form.Item>
```

- [ ] **Step 7: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 8: 提交**

```bash
git add src/renderer/components/Explorer/CharacterPanel.tsx
git commit -m "feat(character): 接线角色增删改 IPC 并补 tags 字段"
```

---

### Task 5: 世界观面板接线（阶段 13）

**Files:**
- Modify: `src/renderer/components/Explorer/SettingPanel.tsx`

**Interfaces:**
- Consumes: Task 3 的 `useSetting()`。
- Produces: 设定增删改持久化到 `settings/<category>/*.json`。

- [ ] **Step 1: 引入 useSetting**

在第 29 行 `import type { Setting, SettingCategory } from '@/common/ipc'` 之后新增：
```ts
import { useSetting } from '../../hooks/useIPC'
```
在组件内 `const [settings, setSettings] = useState<Setting[]>([])` 之前新增：
```ts
  const { getAllSettings, createSetting, updateSetting, deleteSetting } = useSetting()
```

- [ ] **Step 2: loadSettings 用正确 API**

将 `loadSettings`（59-69 行）替换为：
```ts
  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getAllSettings(projectPath)
      setSettings(list)
    } catch (error) {
      console.error('加载设定失败:', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath, getAllSettings])
```

- [ ] **Step 3: handleSave 接 IPC**

将 `handleSave`（98-113 行）替换为：
```ts
  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (editingSetting) {
        await updateSetting(projectPath, { ...editingSetting, ...values })
        messageApi.success('设定已更新')
      } else {
        await createSetting(projectPath, { ...values })
        messageApi.success('设定已创建')
      }
      setModalVisible(false)
      loadSettings()
    } catch (error) {
      messageApi.error('保存失败')
    }
  }
```

- [ ] **Step 4: handleDelete 接 IPC**

将 `handleDelete`（116-123 行）替换为：
```ts
  const handleDelete = async (settingId: string) => {
    try {
      await deleteSetting(projectPath, settingId)
      messageApi.success('设定已删除')
      loadSettings()
    } catch (error) {
      messageApi.error('删除失败')
    }
  }
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/Explorer/SettingPanel.tsx
git commit -m "feat(setting): 接线设定增删改 IPC"
```

---

### Task 6: 章节重命名接线（阶段 10）

**Files:**
- Modify: `src/renderer/components/Explorer/ChapterTree.tsx`

**Interfaces:**
- Consumes: `useChapter().renameChapter`（已存在）。
- Produces: 右键重命名真正调用后端并刷新；复制改为「未实现」提示。

- [ ] **Step 1: 解构 renameChapter**

第 34 行：
```ts
  const { createChapter, deleteChapter, reorderChapters } = useChapter()
```
改为：
```ts
  const { createChapter, deleteChapter, reorderChapters, renameChapter } = useChapter()
```

- [ ] **Step 2: showRenameModal.onOk 调 renameChapter**

将 `showRenameModal`（65-84 行）替换为：
```ts
  const showRenameModal = (chapter: Chapter) => {
    let newTitle = chapter.title
    Modal.confirm({
      title: '重命名章节',
      content: (
        <Input
          defaultValue={chapter.title}
          onChange={(e) => { newTitle = e.target.value }}
          placeholder="请输入章节标题"
        />
      ),
      onOk: async () => {
        if (newTitle.trim() && newTitle !== chapter.title) {
          try {
            await renameChapter(projectPath, chapter.id, newTitle.trim())
            messageApi.success('章节已重命名')
            onChapterChange()
          } catch (error) {
            messageApi.error('重命名失败')
          }
        }
      }
    })
  }
```

- [ ] **Step 3: copyChapter 改为未实现提示**

将 `copyChapter`（87-91 行）替换为：
```ts
  const copyChapter = () => {
    messageApi.info('复制章节功能暂未实现')
  }
```
右键菜单项 `onClick: () => copyChapter(chapter)` 改为 `onClick: () => copyChapter()`。

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/Explorer/ChapterTree.tsx
git commit -m "fix(chapter): 重命名接入 renameChapter，复制改为未实现提示"
```

---

### Task 7: MonacoEditor forwardRef 暴露 revealLineInCenter + wordWrap/showLineNumbers props

**Files:**
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx`

**Interfaces:**
- Produces: `MonacoEditorHandle { revealLineInCenter(lineNumber: number): void }`；props `wordWrap?: boolean`、`showLineNumbers?: boolean`。

- [ ] **Step 1: 修正 imports**

第 1 行：
```ts
import { useRef, useEffect, useState, useCallback } from 'react'
```
改为：
```ts
import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
```
删除第 3 行 `import { useEditorStore } from '@/stores'`（未用）。

- [ ] **Step 2: 接口加 props + 导出 Handle 类型**

在 `MonacoEditorProps` 接口末尾（`fontSize?: number` 之后）加：
```ts
  wordWrap?: boolean
  showLineNumbers?: boolean
```
在 `interface MonacoEditorProps { ... }` 之后、组件定义之前新增：
```ts
export interface MonacoEditorHandle {
  revealLineInCenter: (lineNumber: number) => void
}
```

- [ ] **Step 3: 组件改 forwardRef 并解构新 props**

将组件签名（原文件第 60-70 行，注意原签名**未**解构 `theme`）：
```ts
function MonacoEditor({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true,
  focusMode = false,
  typewriterMode = false,
  fontSize = 16
}: MonacoEditorProps) {
```
替换为：
```ts
const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(function MonacoEditor({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true,
  focusMode = false,
  typewriterMode = false,
  fontSize = 16,
  wordWrap = true,
  showLineNumbers = false
}, ref) {
```
**重要：** 组件函数体末尾原闭合 `}`（约第 334 行）需改为 `})` 以闭合 `forwardRef(`。即文件末尾结构变为：
```ts
  )
})

export default MonacoEditor
```

- [ ] **Step 4: 暴露 imperative handle**

在 `const decorationRef = useRef<string[]>([])` 这一行**删除**（未用），并在 `const [isLoading, setIsLoading] = useState(true)` 之后新增：
```ts
  useImperativeHandle(ref, () => ({
    revealLineInCenter: (lineNumber: number) => {
      editorRef.current?.revealLineInCenter(lineNumber)
    }
  }), [])
```

- [ ] **Step 5: 清理 centerCursorInTypewriterMode 未用变量**

将 `centerCursorInTypewriterMode` 替换为：
```ts
  const centerCursorInTypewriterMode = useCallback(() => {
    if (!editorRef.current) return
    const position = editorRef.current.getPosition()
    if (!position) return
    editorRef.current.revealLineInCenter(position.lineNumber)
  }, [])
```

- [ ] **Step 6: 创建编辑器时用 props**

在 `monaco.editor.create(...)` 的 options 中，将：
```ts
          wordWrap: 'on',
          minimap: { enabled: false },
          lineNumbers: 'off',
```
改为：
```ts
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          lineNumbers: showLineNumbers ? 'on' : 'off',
```

- [ ] **Step 7: 删除未用常量 typewriterDecorationCss**

删除文件顶部 `const typewriterDecorationCss = \`...\`` 整段（约 36-44 行，未用）。

- [ ] **Step 8: 新增 wordWrap/showLineNumbers effects**

在「更新字体大小」effect 之后新增：
```ts
  // 更新自动换行
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' })
    }
  }, [wordWrap])

  // 更新行号显示
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ lineNumbers: showLineNumbers ? 'on' : 'off' })
    }
  }, [showLineNumbers])
```

- [ ] **Step 9: 文件末尾导出**

确保文件末尾仍为：
```ts
export default MonacoEditor
```
（forwardRef 组件默认导出不变。）

- [ ] **Step 10: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 11: 提交**

```bash
git add src/renderer/components/Editor/MonacoEditor.tsx
git commit -m "refactor(editor): forwardRef 暴露 revealLineInCenter，接 wordWrap/行号 props"
```

---

### Task 8: ProjectDialog 回调传递 ProjectData + Home 透传 config

**Files:**
- Modify: `src/renderer/components/Dialogs/ProjectDialog.tsx` (接口, import, 2 处回调调用)
- Modify: `src/renderer/pages/Home/index.tsx` (import, 2 个 handler)

**Interfaces:**
- Produces: Workspace 经 `location.state.config` 获得项目配置（用于自动保存间隔）。

- [ ] **Step 1: ProjectDialog 接口改为传 ProjectData**

第 11 行：
```ts
import type { ProjectType, RecentProject } from '../../common/ipc'
```
改为：
```ts
import type { ProjectType, RecentProject, ProjectData } from '@/common/ipc'
```
第 17-23 行接口：
```ts
interface ProjectDialogProps {
  open: boolean
  mode: 'create' | 'open'
  onClose: () => void
  onProjectCreated?: (projectPath: string) => void
  onProjectOpened?: (projectPath: string) => void
}
```
改为：
```ts
interface ProjectDialogProps {
  open: boolean
  mode: 'create' | 'open'
  onClose: () => void
  onProjectCreated?: (project: ProjectData) => void
  onProjectOpened?: (project: ProjectData) => void
}
```

- [ ] **Step 2: ProjectDialog 调用改传 project**

`handleCreate` 中（124 行）`onProjectCreated?.(project.path, project.name)` 改为：
```ts
      onProjectCreated?.(project)
```
`handleOpen` 中（143 行）`onProjectOpened?.(project.path, project.name)` 改为：
```ts
      onProjectOpened?.(project)
```

- [ ] **Step 3: Home import 修正并引 ProjectData**

第 5 行：
```ts
import type { RecentProject } from '../../common/ipc'
```
改为：
```ts
import type { RecentProject, ProjectData } from '@/common/ipc'
```

- [ ] **Step 4: Home handlers 接 ProjectData 并透传 config**

`handleProjectCreated`（40-43 行）：
```ts
  const handleProjectCreated = (projectPath: string, projectName: string) => {
    navigate('/workspace', { state: { project: { name: projectName, path: projectPath } } })
    loadRecentProjects()
  }
```
改为：
```ts
  const handleProjectCreated = (project: ProjectData) => {
    navigate('/workspace', { state: { project: { name: project.name, path: project.path }, config: project.config } })
    loadRecentProjects()
  }
```
`handleProjectOpened`（46-48 行）：
```ts
  const handleProjectOpened = (projectPath: string, projectName: string) => {
    navigate('/workspace', { state: { project: { name: projectName, path: projectPath } } })
  }
```
改为：
```ts
  const handleProjectOpened = (project: ProjectData) => {
    navigate('/workspace', { state: { project: { name: project.name, path: project.path }, config: project.config } })
  }
```
（`handleOpenProject(projectPath)` 处理「最近项目」点击，无 config，保持不变；Workspace 将以默认值兜底。）

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/Dialogs/ProjectDialog.tsx src/renderer/pages/Home/index.tsx
git commit -m "feat(home): 项目回调传递 ProjectData 并透传 config 到 Workspace"
```

---

### Task 9: Workspace 集成（useMenu / 大纲 / 自动保存 / 编辑器设置 props / 专注模式收起侧栏）+ 修正 startAutoSave

**Files:**
- Modify: `src/renderer/services/ipcService.ts:131-156` (startAutoSave 签名/逻辑)
- Modify: `src/renderer/pages/Workspace/index.tsx` (imports, state, refs, handlers, useMenu, useKeyboard, MonacoEditor props, 大纲面板, 自动保存 effect, 专注模式侧栏)

**Interfaces:**
- Consumes: Task 1 `menu.onEvent`、Task 3 `useMenu`、Task 7 `MonacoEditorHandle` + props、Task 8 `state.config`、`useEditorStore`、`startAutoSave`/`stopAutoSave`。
- Produces: 菜单栏动作生效；大纲导航；自动保存；字号/换行/行号即时反映；专注模式收起侧栏。

- [ ] **Step 1: 修正 startAutoSave 签名（消除 void 比较错误）**

将 `src/renderer/services/ipcService.ts` 第 131-149 行：
```ts
interface AutoSaveOptions {
  interval: number
  onSave: (content: string) => void
}

let autoSaveTimer: ReturnType<typeof setInterval> | null = null
let lastContent: string = ''

export function startAutoSave(options: AutoSaveOptions): void {
  stopAutoSave()
  lastContent = ''
  autoSaveTimer = setInterval(() => {
    // 内容变化时保存
    const currentContent = options.onSave(lastContent)
    if (currentContent !== lastContent) {
      lastContent = currentContent
    }
  }, options.interval)
}
```
替换为：
```ts
interface AutoSaveOptions {
  interval: number
  onSave: () => string // 返回当前内容；调用方在内部决定是否真正写盘
}

let autoSaveTimer: ReturnType<typeof setInterval> | null = null
let lastContent: string = ''

export function startAutoSave(options: AutoSaveOptions): void {
  stopAutoSave()
  lastContent = ''
  autoSaveTimer = setInterval(() => {
    const currentContent = options.onSave()
    if (currentContent !== lastContent) {
      lastContent = currentContent
    }
  }, options.interval)
}
```

- [ ] **Step 2: Workspace 修正 imports**

第 1 行改为（加 `useRef`）：
```ts
import React, { useState, useEffect, useCallback, useRef } from 'react'
```
第 24 行：
```ts
import type { Chapter } from '../../common/ipc'
```
改为：
```ts
import type { Chapter, ProjectConfig } from '@/common/ipc'
```
在现有组件 import 区（`import CommandPalette from ...` 之后）新增：
```ts
import OutlineView from '../../components/Editor/OutlineView'
import type { MonacoEditorHandle } from '../../components/Editor/MonacoEditor'
import { useMenu } from '../../hooks/useMenu'
import { startAutoSave, stopAutoSave } from '../../services/ipcService'
import { useEditorStore } from '../../../stores'
```

- [ ] **Step 3: WorkspaceState 加 config**

```ts
interface WorkspaceState {
  project?: { name: string; path: string }
  projectPath?: string
  config?: ProjectConfig
}
```

- [ ] **Step 4: 组件内新增 state / refs / config**

在 `const { message } = App.useApp()` 之后、`const { getAllChapters, ... } = useChapter()` 之前新增：
```ts
  const { fontSize, wordWrap, showLineNumbers } = useEditorStore()
  const editorRef = useRef<MonacoEditorHandle>(null)
```
在现有 `const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)` 之后新增：
```ts
  const [outlineVisible, setOutlineVisible] = useState(false)
```
在 `const projectPath = ...` / `const projectName = ...` 之后新增：
```ts
  const config = state?.config
  const autoSaveEnabled = config?.autoSave ?? true
  const autoSaveInterval = config?.autoSaveInterval ?? 30000
```
在上述之后新增 dirty/content refs：
```ts
  const isDirtyRef = useRef(false)
  const editorContentRef = useRef(editorContent)
  useEffect(() => {
    editorContentRef.current = editorContent
  }, [editorContent])
```

- [ ] **Step 5: handleSave 成功后清 dirty + handleEditorChange 包装**

在 `handleSave` 内 `message.success('保存成功')` 之前加：
```ts
      isDirtyRef.current = false
```
在 `handleSave` 定义之后新增：
```ts
  const handleSaveRef = useRef(handleSave)
  useEffect(() => {
    handleSaveRef.current = handleSave
  })

  // 编辑器内容变化包装：置 dirty
  const handleEditorChange = (val: string) => {
    setEditorContent(val)
    isDirtyRef.current = true
  }
```

- [ ] **Step 6: 自动保存 effect**

在 Step 5 的代码之后新增：
```ts
  // 自动保存：按配置间隔写盘
  useEffect(() => {
    if (!currentChapter || !autoSaveEnabled) return
    startAutoSave({
      interval: autoSaveInterval,
      onSave: () => {
        if (isDirtyRef.current) {
          void handleSaveRef.current()
        }
        return editorContentRef.current
      }
    })
    return () => stopAutoSave()
  }, [currentChapter?.id, autoSaveEnabled, autoSaveInterval])
```

- [ ] **Step 7: 接入 useMenu**

在 `useKeyboard({ ... })` 调用之前新增：
```ts
  // 菜单栏事件
  useMenu((event, ...args) => {
    switch (event) {
      case 'newChapter':
        handleCreateChapter()
        break
      case 'save':
        handleSave()
        break
      case 'focusMode':
        setFocusMode(args[0] as boolean)
        break
      case 'typewriterMode':
        setTypewriterMode(args[0] as boolean)
        break
      case 'toggleOutline':
        setOutlineVisible((v) => !v)
        break
      case 'toggleChapterTree':
        setSidebarCollapsed((v) => !v)
        break
      default:
        console.log('未处理的菜单事件:', event)
    }
  })
```

- [ ] **Step 8: useKeyboard 加 outline/sidebar**

在 `useKeyboard({ ... })` 调用中追加两个回调：
```ts
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onOutline: () => setOutlineVisible((v) => !v)
```

- [ ] **Step 9: 专注模式收起侧栏**

将左侧 `<Sider>` 的 `collapsed={sidebarCollapsed}` 改为：
```ts
        collapsed={sidebarCollapsed || focusMode}
```

- [ ] **Step 10: MonacoEditor 传 ref 与 props，渲染大纲面板**

将主内容区 `<Layout> ... <Content> ... </Content> </Layout>`（原 345-410 行）替换为：
```tsx
      <Layout>
        {/* Tab栏 */}
        <EditorTabs
          chapters={openedChapters}
          currentChapter={currentChapter}
          onSelectChapter={handleOpenChapter}
          onCloseChapter={handleCloseChapter}
          onSaveChapter={handleSave}
        />

        {/* 工具栏 */}
        <Header style={{
          padding: 0,
          background: '#1e1e1e',
          height: 'auto',
          lineHeight: 'normal'
        }}>
          <EditorToolbar
            onSave={handleSave}
            chapterTitle={chapterTitle}
            onTitleChange={setChapterTitle}
            wordCount={editorContent.length}
            focusMode={focusMode}
            typewriterMode={typewriterMode}
            onToggleFocus={setFocusMode}
            onToggleTypewriter={setTypewriterMode}
          />
        </Header>

        {/* 编辑器 + 大纲 */}
        <Layout>
          <Content style={{ background: '#1e1e1e', padding: 0, flex: 1 }}>
            {currentChapter ? (
              <MonacoEditor
                ref={editorRef}
                value={editorContent}
                onChange={handleEditorChange}
                onSave={handleSave}
                focusMode={focusMode}
                typewriterMode={typewriterMode}
                fontSize={fontSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
              />
            ) : (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666'
              }}>
                <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <Text style={{ color: '#888' }}>
                  {chapters.length === 0 ? '暂无章节，点击新建章节开始创作' : '选择一个章节开始编辑'}
                </Text>
                {chapters.length === 0 && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleCreateChapter}
                    style={{ marginTop: 16 }}
                  >
                    新建章节
                  </Button>
                )}
              </div>
            )}
          </Content>

          {outlineVisible && currentChapter && (
            <Sider
              width={260}
              theme="dark"
              style={{ background: '#252526', borderLeft: '1px solid #333', overflow: 'auto' }}
            >
              <OutlineView
                content={editorContent}
                onNavigateToLine={(ln) => editorRef.current?.revealLineInCenter(ln)}
              />
            </Sider>
          )}
        </Layout>
      </Layout>
```

- [ ] **Step 11: 验证构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 12: 提交**

```bash
git add src/renderer/services/ipcService.ts src/renderer/pages/Workspace/index.tsx
git commit -m "feat(workspace): 接入菜单/大纲/自动保存/编辑器设置，专注模式收起侧栏"
```

---

### Task 10: 终态构建 + tsc 对比 + 手动走查

**Files:** 无（验证任务）

- [ ] **Step 1: 全量构建**

Run: `npm run build`
Expected: exit 0，`✓ built in ...s`

- [ ] **Step 2: tsc 错误数不上升（咨询性）**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 数值 **≤** Task 0 baseline（`docs/superpowers/specs/tsc-baseline.txt` 的计数）。重写过的文件（CharacterPanel/SettingPanel/ChapterTree/MonacoEditor/useMenu/preload/menu/ProjectDialog/Home/Workspace）应不再出现于错误列表。

- [ ] **Step 3: 启动 dev 手动走查**

Run: `npm run dev`（若 electron 二进制缺失，按 README 排查章节跑 `node node_modules/electron/install.js`）

逐项验证：
1. 新建项目 → 进入 Workspace → 新建章节 → 写正文 → Ctrl+S 保存成功。
2. 菜单栏「文件 → 新建章节」「文件 → 保存」「查看 → 专注模式（侧栏收起）」「查看 → 大纲」均生效。
3. 侧栏切到「角色」→ 创建角色（填姓名/性别/年龄/定位/标签/外貌等）→ 保存 → 列表出现 → 编辑改字段 → 保存 → 删除。关闭项目重开，角色仍在（`<项目>/characters/*.json`）。
4. 侧栏切到「设定」→ 按分类创建设定 → 保存 → 编辑 → 删除。重开项目仍在（`<项目>/settings/<category>/*.json`）。
5. 章节树右键「重命名」→ 输入新名 → 章节标题与文件名更新。
6. 设置页改字号 → 编辑器字号即时变化；改自动换行/行号 → 即时反映。
7. 大纲面板（Ctrl+Shift+O 或菜单「查看 → 大纲」）→ 写几个 `##` 标题 → 点击大纲项 → 编辑器滚动到对应行。
8. 自动保存：编辑正文后等待 30s（不手动保存）→ 关闭项目重开 → 修改仍在。

- [ ] **Step 4: 收尾提交（如有走查修复）**

若走查中发现并修复了小问题，提交：
```bash
git add -A
git commit -m "fix: 走查修复"
```

- [ ] **Step 5: 更新文档状态**

更新 `README.md` 进度总览表中阶段 8/10/11/12/13/14/18 的状态为真实结果，并更新 `docs/AUDIT.md` 顶部加一行「2026-06-25 复审：阶段 8/10/11/12/13 已接线可用」。提交：
```bash
git add README.md docs/AUDIT.md
git commit -m "docs: 更新进度总览与审计状态"
```

# M1：UI 气质改造 + 地基还债 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成「完美小说」M1：产品更名（含 userData 搬运）、中文正确的字数统计、统一 IPC 门面、收敛 tab/最近项目双真源、拆分 Workspace 与 handlers.ts、tsc 34 错清零并把类型检查纳入 build、补齐设计 token 并完成正文纸墨排版与专注模式打磨。

**Architecture:** 演进式重构，不改任何磁盘数据格式（`.novelwriter.json`/章节文件名约定原样保留，M2 才迁移）。渲染进程只保留 `window.novelWriter` 一个类型化门面；跨进程共享的纯逻辑（字数统计）下沉 `src/common/`；Workspace 的状态编排拆入 `pages/Workspace/hooks/`，组件树按面板下沉；主进程 handlers.ts 按 IPC 域拆为模块后由注册器聚合。

**Tech Stack:** Electron 28 + electron-vite + React 18 + TypeScript 5（strict）+ Zustand + antd 5 + monaco-editor；新增 devDependency：vitest（仅 node 环境测纯函数，不引入 jsdom/RTL）。

**Spec:** `docs/superpowers/specs/2026-10-25-perfect-novel-repositioning-design.md`（本计划实现其 §2 更名、§3 G6/G7/G8、§7.1 迁移、§7.6 全部、§8 M1 行）

## Global Constraints

- 不新增运行时依赖；唯一新增 devDependency 为 `vitest`。
- TypeScript strict 全仓通过；`npm run build` 定义改为 `npm run typecheck && electron-vite build`（Task 2 起生效）。
- 不改磁盘数据格式（章节文件名 `NNN-标题.md`、`.novelwriter.json`、characters/settings JSON 均原样读写）。
- UI 文案一律中文；App 显示名"完美小说"，英文标识 `perfect-novel`。
- 每个 Task 结束时提交一次；commit message 用 conventional 前缀（feat/fix/refactor/style/test/chore/docs），末尾空一行加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 每个 Task 的回归门：`npm run typecheck && npm run lint && npm run test`（Task 1 起）全绿；涉及 UI 的 Task 另跑文末"手动冒烟清单"对应项。
- 现状基准：`npx tsc --noEmit` 当前 34 错（清单见本次规划会话输出）；lint 已 0 error。

## Review Focus

规格里没写、但最容易在这里咬人的输入（每条在对应 Task 有钉住的测试或冒烟项）：

1. **中英数字混排的正文计数**——工具栏字数、统计面板今日字数、章节文件 `wordCount` 三处口径必须一致且把 CJK 按字计、标点不计（Task 4 单测）。
2. **老 userData 目录存在（发起人本机装有 novel-writer）时的首启**——主题/窗口状态搬运成功；`perfect-novel` 目录已存在时不得覆盖（Task 3 单测）。
3. **亮色主题冷启动防闪屏链路**——token 化与主题色替换后，首帧仍不闪白/闪错色（Task 9/10 冒烟）。
4. **旧格式书目录照常被读写**——更名与 IPC 合一不得影响打开既有项目、编辑、保存、导出（Task 5/6/8 冒烟）。
5. **切章→返回→关窗三路径的脏数据静默 flush**——Workspace 拆分后行为与现状逐字一致，不丢字、不重复计数（Task 7 冒烟）。

---

### Task 1: 引入 vitest 测试基建

**Files:**
- Modify: `package.json`（devDependencies + scripts）
- Create: `vitest.config.ts`
- Create: `src/renderer/services/statsService.test.ts`（冒烟测试）

**Interfaces:**
- Produces: `npm run test` = `vitest run`；后续所有 Task 的测试载体。

- [ ] Step 1: `npm i -D vitest`；`package.json` scripts 增加 `"test": "vitest run"`。
- [ ] Step 2: 创建 `vitest.config.ts`：`test.include = ['src/**/*.test.ts', 'electron/**/*.test.ts', 'tests/**/*.test.ts']`，`resolve.alias` 配 `@ -> ./src`，环境默认 node。
- [ ] Step 3: 写冒烟测试 `statsService.test.ts`：`addWords(EMPTY_STATS, 5)` 后 `todayWords() === 5`；`computeStreak` 空数据返回 0。
- [ ] Step 4: `npm run test` 通过（2 passed）。
- [ ] Step 5: Commit `chore(test): add vitest baseline for pure-function coverage`。

### Task 2: tsc 34 错清零，类型检查纳入 build

**Files:**
- Modify: `tsconfig.json`（compilerOptions 增加 `"types": ["node", "vite/client"]`）
- Modify: `package.json`（`"typecheck": "tsc --noEmit"`；`"build": "npm run typecheck && electron-vite build"`）
- Modify: 报错的 17 个源文件（清单见下"处置表"）
- Modify: `docs/superpowers/specs/tsc-baseline.txt`（更新为 0 错说明）

**Interfaces:**
- Produces: `npm run typecheck` 退出码 0；渲染进程内共享类型 import 统一为 `@/common/ipc`，主进程内统一为相对 `../../../src/common/ipc`。

处置表（按错误类）：
- 模块路径（TS2307）：`EditorTabs.tsx:10`、`ipcService.ts:3`、`stores/index.ts:3` 改为 `@/common/ipc`；`handlers.ts:7` 改为 `../../../src/common/ipc`。
- `import.meta.env`（TS2339）：由 tsconfig `types` 引入 `vite/client` 解决，代码不动。
- 未使用（TS6133）：删除 `React` 默认导入（App/EditorToolbar/ThemeToggle/Home/Workspace，jsx=react-jsx 无需）；删除 `Title`（ExportDialog:22、CharacterPanel:31、Workspace:41）；删除 `mainWindow` 与 `setMainWindow`（handlers.ts:12-16，全仓无调用方）；删除 `send`（ipcService.ts:13）；`loading/setLoading`（SettingPanel:54、Workspace:84）删除该状态及其赋值；`handleDeleteChapter`（Workspace:296-311）删除（删除路径已由 ChapterTree 右键菜单走 `useChapter`）；`addTab/reorderTabs`（EditorTabs:29）解构移除。
- antd 类型（TS2322/TS2749/TS2339）：`CommandPalette.tsx:43` `Input` 类型改 `typeof Input`；两处 `List hoverable` 改 `className` + CSS hover（或去掉 hoverable）；`OutlineView.tsx:50` 与 `ChapterTree.tsx:155` 的 `DataNode[]` 收窄——`info.node` 类型用 `import type { EventDataNode } from 'antd/es/tree'`，`selectedKeys[0]` 处先判 `?? []`。
- CSS 类型（TS2353）：`WebkitAppRegion` 四处（ThemeToggle:22、Home:65/78/91）——新建 `src/renderer/styles/css.ts`，导出 `export function appRegionStyle(region: 'drag' | 'no-drag'): React.CSSProperties { return { WebkitAppRegion: region } as React.CSSProperties }`，四处改用它。
- `theme.ts:31/61` 无效 token `colorActiveBar` 删除（Task 9 会用有效 token 重建 Tabs 主题）。

- [ ] Step 1: 按处置表逐文件修复；每修一处跑一次 `npm run typecheck` 观察错误数递减。
- [ ] Step 2: `npm run typecheck` 0 错；`npm run lint`、`npm run test` 仍绿。
- [ ] Step 3: 改 `package.json` build 脚本串入 typecheck；`npm run build` 成功。
- [ ] Step 4: `tsc-baseline.txt` 更新为"0 错，typecheck 已入门禁"。
- [ ] Step 5: Commit `fix(types): clear all 34 tsc errors and gate build on typecheck`。

### Task 3: 更名 perfect-novel + userData 搬运

**Files:**
- Create: `electron/main/userData.ts` + `electron/main/userData.test.ts`
- Modify: `electron/main/index.ts`（whenReady 前调用搬运）
- Modify: `package.json`（`"name": "perfect-novel"`，description 改"完美小说 – AI 共著的小说创作工作台"）
- Modify: `src/renderer/pages/Home/index.tsx:69`（标题文案"完美小说"）、`electron/main/menu.ts:212`（关于）、`electron/main/tray.ts:26`（tooltip）、`electron/main/window.ts:97`（设置窗标题）
- Modify: `README.md`（项目名与一句定位重写，细节留给执行者按 README 现状微调）

**Interfaces:**
- Produces: `migrateUserData(oldDir: string, newDir: string): 'migrated' | 'skipped'`——newDir 已存在返回 skipped；否则递归复制 oldDir 内容（不删除 oldDir）；oldDir 不存在返回 skipped。

- [ ] Step 1: 写失败测试 `userData.test.ts`：临时目录造 `old/theme.json`，new 不存在 → 返回 `'migrated'` 且 new/theme.json 内容一致；new 已存在 → `'skipped'` 且不覆盖（new 内原文件保持）；old 不存在 → `'skipped'`。
- [ ] Step 2: `npm run test` 确认新测试 FAIL。
- [ ] Step 3: 实现 `electron/main/userData.ts`（`fs.cpSync(old, new, { recursive: true, force: false, errorOnExist: true })` 包 try/catch，或手写拷贝——以测试语义为准）；`main/index.ts` 在 `app.whenReady().then` 之前、`loadTheme()` 之前调用 `migrateUserData(path.join(app.getPath('appData'), 'novel-writer'), path.join(app.getPath('appData'), 'perfect-novel'))`。
- [ ] Step 4: `npm run test` PASS；全套回归绿。
- [ ] Step 5: 改 package.json/显示文案；`npm run dev` 冒烟：窗口标题、Home 头、托盘、菜单"关于"均为"完美小说"；（本机若存在旧目录）重启后 theme 选择保留。
- [ ] Step 6: Commit `feat(app): rename to perfect-novel with userData migration`。
- [ ] Step 7:（外向操作，需发起人点头）`gh repo rename perfect-novel` 或让发起人在 GitHub 上改名。

### Task 4: 中文正确的字数统计口径

**Files:**
- Create: `src/common/wordCount.ts` + `src/common/wordCount.test.ts`
- Modify: `electron/main/ipc/handlers.ts:168/208/275/340`（4 处 wordCount 计算）
- Modify: `src/renderer/pages/Workspace/index.tsx`（`handleEditorChange` 增量、`EditorToolbar wordCount` prop）
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx:322-330,354-370`（去掉 `getElementById('editor-word-count')` DOM hack，改 React state 渲染底部状态条）

**Interfaces:**
- Produces: `countWords(text: string): number`——CJK 字符（`一-鿿`、`㐀-䶿`）每字计 1；连续拉丁字母/数字串各计 1；markdown 语法字符（`# * ` > ~ _ [ ] ( )`）与其包围标点不计；空串 0。统计增量口径 = `countWords` 差值。

- [ ] Step 1: 写失败测试：`countWords('')===0`、`countWords('你好，世界')===4`、`countWords('Hello world 你好')===4`、`countWords('**加粗文本** and more')===6`、`countWords('第123章')===4`（第+123+章 按 汉字×2+数字串×1+…——执行时若语义有歧义，以"数字连续串计 1"为准，即 `第123章`===3；把断言写成实现前讨论定案的那个值，不得来回改）。**定案：`第123章`===3**（汉字各 1，数字串 1）。
- [ ] Step 2: 运行确认 FAIL。
- [ ] Step 3: 实现 `countWords`（正则：先剥 markdown 标记字符，再 `text.match(/[㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0` + `text.match(/[A-Za-z0-9]+/g)?.length ?? 0`）。主进程 4 处与渲染层增量、工具栏、状态条全部改用它。
- [ ] Step 4: `npm run test` PASS；回归全绿。
- [ ] Step 5: `npm run dev` 冒烟：输入 `你好 Hello 123`，工具栏字数与底部状态条一致为 `5`；保存重开后章节列表字数列一致（Review Focus 1）。
- [ ] Step 6: Commit `feat(stats): count CJK characters and latin runs correctly`。

### Task 5: 统一 IPC 门面（拆掉裸通道 electronAPI 与 ipcService）

**Files:**
- Modify: `src/common/ipc.ts`（新增导出 `NovelWriterApi` 接口——即渲染进程可用的门面类型：现有 project/file/chapter/character/setting/dialog 组 + `theme:{set}`、`stats:{get,save}`、`export:{word,pdf,epub}`、`dialog.saveFile(params:{defaultPath,filters?})`、`on`、`menu.onEvent`；`RendererToMainRequests` 同步补 theme/stats/export 通道并修正 saveFile 参数形状）
- Modify: `electron/preload/index.ts`（novelWriter 对象补齐 theme/stats/export 分组与带 filters 的 saveFile；`NovelWriterAPI` 类型删除、改为 implements `NovelWriterApi`；`declare global` 只留 `Window{novelWriter: NovelWriterApi}`；删除整段 `contextBridge.exposeInMainWorld('electronAPI', …)`）
- Modify: `src/renderer/hooks/useIPC.ts`（`getIPC(): NovelWriterApi`；新增 `useStats`（getStats/saveStats）、`useExport`（exportDocument(format, params)）、`useTheme`（setThemeMode）；`useDialog().saveFile(defaultPath, filters?)`）
- Move: `ipcService.ts:154-180` startAutoSave/stopAutoSave → `src/renderer/services/autoSave.ts`（原样移动）
- Delete: `src/renderer/services/ipcService.ts`
- Modify: `src/renderer/index.tsx:7`、`src/renderer/pages/Workspace/index.tsx:27` 改用 `useTheme/useStats/useExport/useDialog` hooks
- Modify: `electron/main/ipc/handlers.ts:380-399`（dialog:saveFile handler 参数从 `(defaultPath, filters)` 双参统一为 `params:{defaultPath, filters?}` 对象，与类型一致）

**Interfaces:**
- Consumes: Task 2 的 `@/common/ipc` 路径规范。
- Produces: 全仓仅存 `window.novelWriter` 一条 IPC 通路；后续 Task 引用 `useStats/useExport/useTheme` 而非 ipcService。

- [ ] Step 1: 先改 `common/ipc.ts` 的 `NovelWriterApi`，再改 preload（TS 会立刻在 preload 报缺项，作为实现清单）。
- [ ] Step 2: 改 handlers.ts saveFile 参数形状（唯一渲染侧调用方传对象，兼容改法直接切）。
- [ ] Step 3: 建 `autoSave.ts`，重写 useIPC hooks，迁移 index.tsx / Workspace 两处 import，删除 ipcService.ts。
- [ ] Step 4: `grep -rn "electronAPI\|ipcService" src electron --include="*.ts*"` 无结果；`npm run typecheck` 0 错；回归全绿。
- [ ] Step 5: dev 冒烟（Review Focus 4）：开旧项目→编辑→Ctrl+S→导出 Markdown 与 docx 各一次成功→切换主题窗口底色跟随。
- [ ] Step 6: Commit `refactor(ipc): single typed novelWriter facade, drop raw electronAPI bridge`。

### Task 6: 双真源收敛（tab 与最近项目）

**Files:**
- Modify: `src/renderer/stores/index.ts`（删除 `useTabStore` 与 `TabState`）
- Modify: `src/renderer/components/Layout/EditorTabs.tsx`（改为纯受控：props 增 `activeChapterId: string | null`、删死 prop `onSaveChapter`（组件内本就 `_onSaveChapter` 未用，Workspace:630 的传参一并删），内部不再读写 store；"关闭其他/全部/右侧/切换下一个"全部基于 props 循环调用 `onCloseChapter`/`onSelectChapter`；删除激活同步 effect）
- Modify: `src/renderer/pages/Workspace/index.tsx`（`<EditorTabs activeChapterId={currentChapter?.id} …>`）
- Modify: `src/renderer/pages/Home/index.tsx`（最近项目改读 `useProjectStore().recentProjects`，删 `loadRecentProjects`/`useProject`；打开与新建成功回调里 `addRecentProject({ id: project.path, name: project.name, path: project.path, lastOpened: new Date().toISOString() })`）
- Modify: `src/renderer/components/Dialogs/ProjectDialog.tsx`（打开模式列表改读 store，删 `getRecentProjects` 调用；create/open 成功路径同样 `addRecentProject`）
- Modify: `src/common/ipc.ts`（`RecentProject.lastOpened: string`（ISO），删 `'project:getRecent'`）
- Modify: `electron/preload/index.ts`（删 getRecent 三处）、`electron/main/ipc/handlers.ts`（删 `recentProjects` Map 与 `project:getRecent` handler 及两处 `recentProjects.set`）

**Interfaces:**
- Consumes: Task 5 的 hooks。
- Produces: `useProjectStore.recentProjects: RecentProject[]` 为唯一最近项目真源（persist localStorage，重启不丢——修掉 AUDIT 记录的"重启即丢"）；EditorTabs props：`{ chapters, activeChapterId, currentChapter, onSelectChapter, onCloseChapter }`。

- [ ] Step 1: 先改 EditorTabs 为受控（tsc 会在 Workspace 报缺 prop，按提示补 `activeChapterId`）。
- [ ] Step 2: 删 `useTabStore` 与 `tab-storage`（localStorage 残键不管，无害）。
- [ ] Step 3: Home/ProjectDialog 切 store；`lastOpened` 显示处用 `dayjs(iso).format('YYYY-MM-DD HH:mm')`。
- [ ] Step 4: 主进程/preload/common 三处删 getRecent 链路。
- [ ] Step 5: `npm run typecheck && npm run lint && npm run test` 绿；grep `useTabStore`、`project:getRecent` 无结果。
- [ ] Step 6: dev 冒烟：开两章→关闭其一→激活位正确；杀进程重启→Home 最近项目仍在、可点开（Review Focus 4）。
- [ ] Step 7: Commit `refactor(state): single sources of truth for tabs and recent projects`。

### Task 7: 拆分 Workspace god component

**Files:**
- Create: `src/renderer/pages/Workspace/hooks/useEditorSession.ts`
- Create: `src/renderer/pages/Workspace/hooks/useWritingStats.ts`
- Create: `src/renderer/pages/Workspace/hooks/useAutoSave.ts`
- Create: `src/renderer/components/Workspace/SidebarPanel.tsx`
- Modify: `src/renderer/pages/Workspace/index.tsx`（目标 < 260 行：只剩路由参数、hook 编排、菜单/快捷键分发、布局）
- Delete: `src/renderer/services/autoSave.ts`（Task 5 的过渡文件，逻辑并入 useAutoSave）

**Interfaces:**
- Consumes: Task 4 `countWords`、Task 5 `useStats/useExport/useDialog`、Task 6 EditorTabs props。
- Produces（签名钉死，行为照搬现有 `index.tsx` 对应代码段，不改语义）：

```ts
export interface EditorSession {
  chapters: Chapter[]; openedChapters: Chapter[]; currentChapter: Chapter | null
  editorContent: string; chapterTitle: string; setChapterTitle: (t: string) => void
  loadChapters: () => Promise<void>; openChapter: (c: Chapter) => void
  closeChapter: (id: string) => void; createChapter: () => Promise<void>
  save: (opts?: { silent?: boolean }) => Promise<void>
  flushIfDirty: () => void; handleEditorChange: (value: string) => void
}
export function useEditorSession(projectPath: string | undefined): EditorSession
// 语义照搬 :112-231：切章前 flushIfDirty、dirty 门控、函数式回写、防陈旧闭包三 ref

export interface WritingStatsView {
  todayWordCount: number; todayMinutes: number; totalWordCount: number
  streak: number; history: { date: string; words: number; minutes: number }[]
  persistNow: () => void
}
export function useWritingStats(args: {
  projectPath: string | undefined
  chapters: Chapter[]
  editorContent: string
  currentChapterId: string | null
}): WritingStatsView
// 内含：加载 stats、countWords 增量（切章重置基线）、60s 活跃分钟、3s 防抖落盘

export function useAutoSave(args: {
  enabled: boolean; intervalMs: number; chapterId: string | null; flush: () => void
}): void

// SidebarPanel props
{ projectPath: string; projectName: string; tab: SidebarTab; collapsed: boolean
  chapters/statsView/回调（onOpenChapter/onChaptersChanged/onBack/onOpenSettings） }
```

- [ ] Step 1: 提取 `useEditorSession`（纯搬移：state、refs、6 个函数逐行迁移；搬完先跑 typecheck+lint）。
- [ ] Step 2: 提取 `useWritingStats`（增量口径此处从 `content.length` 换成 `countWords`，与 Task 4 汇合）与 `useAutoSave`（`setInterval` + 依赖 `[chapterId, enabled, intervalMs]`，语义同现状"定时器只管周期触发 flush"）。
- [ ] Step 3: 提取 `SidebarPanel.tsx`（现 index.tsx:489-620 的 Sider 区块），Workspace 引用之。
- [ ] Step 3a: 为 §7.6"图谱视图留布局位"兑现：拆分后的 Workspace 主区渲染收敛为单一出口 `renderMainView()`（M1 恒返回现有 编辑器+大纲 视图），后续 M3 在此切出"图谱视图"，本任务不加任何占位 UI。
- [ ] Step 4: beforeunload / handleBack 改调 `session.flushIfDirty + stats.persistNow`；删除过渡文件 `services/autoSave.ts`。
- [ ] Step 5: 回归全绿；`wc -l src/renderer/pages/Workspace/index.tsx` < 260。
- [ ] Step 6: dev 冒烟（Review Focus 5）：写一段→不保存直接切章→回来内容在；写一段→点返回→重进内容在；写一段→直接关窗口→重开内容在；今日字数增量与净输入汉字数一致（含切章不重复计）。
- [ ] Step 7: Commit `refactor(workspace): extract editor session, stats and autosave hooks`。

### Task 8: 拆分 handlers.ts + 死代码清理

**Files:**
- Create: `electron/main/ipc/helpers.ts`（formatFilePath、章节文件名解析等共用小函数）
- Create: `electron/main/ipc/modules/{theme,project,file,chapter,character,setting,stats,export,dialog}.ts`（每个导出 `registerXxxHandlers(): void`，代码逐行搬移）
- Modify: `electron/main/ipc/handlers.ts` → 变成聚合入口（保留文件，内容改为 import + `registerAllIpcHandlers()`）
- Modify: `electron/main/window.ts`（删除 `createSettingsWindow`/`getSettingsWindow`/`settingsWindow`——无人调用，Settings 走渲染路由）
- Delete: `vite.config.ts`（历史残留）

**Interfaces:**
- Produces: 通道名与行为零变化；`import './ipc/handlers'` 入口不变（main/index.ts:6 不动）。

- [ ] Step 1: 按域逐个搬移（每搬一域跑一次 typecheck），helpers.ts 承接跨域小函数。
- [ ] Step 2: 删 createSettingsWindow 与 vite.config.ts。
- [ ] Step 3: 回归全绿；`grep -c "ipcMain.handle" electron/main/ipc/modules/*.ts` 合计 = 33。
- [ ] Step 4: dev 冒烟 Review Focus 4 全链一遍。
- [ ] Step 5: Commit `refactor(main): split ipc handlers by domain, drop dead settings window`。

### Task 9: 设计 token 补齐 + antd 覆盖样式去 !important

**Files:**
- Modify: `src/renderer/styles/global.css`（新增两套主题下都定义的：`--space-1:4px --space-2:8px --space-3:12px --space-4:16px --space-5:24px --space-6:32px`；`--font-xs:12px --font-sm:13px --font-md:14px --font-lg:16px --font-xl:20px`；`--radius-sm:4px --radius-md:6px --radius-lg:8px`；`--color-success:#52c41a --color-warning:#faad14`；`--color-paper`（Task 10 用）。滚动条/选中色等原生规则保留）
- Modify: `src/renderer/styles/theme.ts`（darkTheme/lightTheme 用组件 token 表达现 CSS 里的强制覆盖：`Button: { colorPrimary/colorPrimaryHover/colorPrimaryActive }`（dark 用 #0d419d/#1f6feb 系）、`Modal: { contentBg, headerBg, footerBg, titleColor }`、`Tree: { nodeSelectedBg, nodeHoverBg }`、`Input: { colorTextPlaceholder }`、`Tabs: { itemSelectedColor, inkBarColor, cardBg }`（替代已删的 colorActiveBar））
- Modify: `src/renderer/components/Layout/EditorTabs.tsx`（删尾部 `<style>` 注入：改为 `className="editor-tabs"` + global.css 内 `.editor-tabs .ant-tabs-*` 规则；两处状态色 hex 改 `var(--color-success/--color-warning)`）
- Modify: `src/renderer/components/Explorer/ChapterTree.tsx` 等（dark-modal 类名可保留但样式改由 token 承担，`[data-theme='dark'] .dark-modal *` 大块删除）

**Interfaces:**
- Produces: `--color-paper` 等 token 供 Task 10；!important 预算：global.css 残留 ≤ 3 处（仅 ::-webkit-scrollbar/::selection 等无法用 token 表达的）。

- [ ] Step 1: 先补 token（双主题各值），`npm run test` 无涉及、typecheck 无涉及，直接 build 验证。
- [ ] Step 2: theme.ts 组件 token 迁移：改一块→dev 双主题目验一块（Modal、Button、Tree、Tabs、Input placeholder）。
- [ ] Step 3: EditorTabs `<style>` 迁入 global.css；删 `[data-theme='dark'] .ant-btn-primary/dark-modal` 大块。
- [ ] Step 4: 验收：`grep -o '!important' src/renderer/styles/global.css | wc -l` ≤ 3；全仓 `grep -rn "<style>" src/renderer/components` 无结果；回归全绿。
- [ ] Step 5: 冒烟 Review Focus 3：双主题切换 + 冷启动各 3 次无闪屏、Modal/树/按钮观感与迁移前一致。
- [ ] Step 6: Commit `style(tokens): spacing/typography/radius scale, antd overrides via component tokens`。

### Task 10: 正文纸墨排版 + 专注/打字机模式打磨

**Files:**
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx`（create 选项：`fontFamily: "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',Georgia,serif"`，`lineHeight: Math.round(fontSize * 1.9)`；合并 7 个 `updateOptions` useEffect 为一个（依赖 `[focusMode, typewriterMode, fontSize, wordWrap, showLineNumbers, readOnly]` 统一 updateOptions）；新增 prop `maxWidthPx?: number`（默认 760）用于居中排印容器：容器内套一个 `margin: '0 auto', maxWidth` 的 div 承载编辑器宽度）
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx:9-59`（novel-dark/novel-light `editor.background` 改 `--color-paper` 对应值：dark `#1f1e1c`，light `#faf8f2`；lineHighlight/selection 色微调配平）
- Modify: `src/renderer/pages/Workspace/index.tsx`（focusMode 时隐藏 EditorTabs 与侧栏（现已隐藏）并把 Header 降为仅标题+保存按钮的轻量条；Content padding 用 `var(--space-*)`）
- Modify: `package.json`（删 `@monaco-editor/react` 依赖——运行时未用）
- Modify: `src/renderer/styles/global.css`（`--color-paper` 双主题值已在 Task 9 定义，此处消费）

**Interfaces:**
- Consumes: Task 9 的 `--color-paper`；Task 4 的 React state 状态条（不动其逻辑，只调样式）。

- [ ] Step 1: Monaco 主题与字体/行高/排印宽度改造；双主题 dev 目验正文纸感。
- [ ] Step 2: updateOptions 合并为单 effect（行为不变：逐项改选项后编辑器即时响应）。
- [ ] Step 3: focusMode 隐藏 EditorTabs、Header 轻量化（Workspace 渲染条件，约 10 行）。
- [ ] Step 4: 删 @monaco-editor/react 依赖；回归全绿。
- [ ] Step 5: 冒烟 Review Focus 3 + 排版验收：输入 300 字中文，行长 ≈37 汉字内折行、行高明显松于现状；F 键专注模式下只剩正文与轻量 Header；打字机模式光标居中如旧。
- [ ] Step 6: Commit `feat(ux): serif paper-feel editor typography, lighter focus mode`。

---

## M1 完成定义（DoD）

- `npm run typecheck && npm run lint && npm run test && npm run build` 全绿；
- 全仓无 `ipcService`/`electronAPI`/`useTabStore`/`project:getRecent`/`createSettingsWindow`/`<style>` 注入残留；
- Workspace/index.tsx < 260 行、handlers.ts 入口化、global.css `!important` ≤ 3；
- 双主题冒烟清单（Review Focus 1–5）全部人工过验；
- 发起人确认界面"气质"达标（这是规格里的主观项，验收时由发起人一票否决）。

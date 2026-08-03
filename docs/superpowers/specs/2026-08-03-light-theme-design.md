# 浅色主题设计（Light Theme）

- 日期：2026-08-03
- 状态：已批准（设计阶段），待实现
- 范围：全 App 完整适配深/浅双主题，手动切换，设置页 + 顶栏双入口

## 1. 目标与非目标

### 目标
- 新增浅色主题，与现有深色主题并列；用户可在设置页选择，或在顶栏一键切换。
- 全 App 所有页面/面板/对话框/编辑器在两套主题下都正确显示，无深浅残留。
- 主题选择持久化（刷新/重启后保留）。
- 冷启动无错误主题的闪屏。

### 非目标（YAGNI）
- 不做「跟随系统」（`prefers-color-scheme`）自动切换——本期仅手动两档。
- 不引入第三套主题（如高对比度）。
- 不重构既有组件的业务逻辑，仅替换着色机制。

## 2. 现状（探索结论）

- `src/renderer/index.tsx`：`<ConfigProvider theme={darkTheme}>` 包裹全 App。`darkTheme` 是**手写的 token 对象**（未使用 `theme.darkAlgorithm`），含 `token` + `components` 两段，全部硬编码 hex。
- 全 App 约 **17 个文件、176 处**内联 `style={{ background/color/borderColor: '#...' }}` 硬编码颜色；无 CSS Modules / LESS / SCSS。
- **无任何主题基础设施**：无 CSS 变量、无 antd algorithm、无 theme store/context。
- `src/renderer/components/Settings/ThemeSettings.tsx`：已有「主题」分区，含一个 disabled 的「浅色 (开发中)」按钮，和一个被下划线忽略的 `onThemeChange?: (theme: 'dark'|'light')` prop——意图/脚手架已就位，只差接线。
- 状态管理：`src/renderer/stores/index.ts` 用 zustand + `persist` + `localStorage`（`useTabStore`/`useProjectStore`/`useEditorStore`/`useShortcutStore`），但**无 settings/theme store**。
- 全局样式：唯一 `src/renderer/styles/global.css`，含 `body` 背景与大量 `.ant-*` / `.chapter-tree` / `.dark-modal` 的 `!important` 深色覆盖。
- Monaco：`src/renderer/components/Editor/MonacoEditor.tsx` 定义并注册 `novel-dark`（`base: 'vs-dark'`），`monaco.editor.create` 里硬编码 `theme: 'novel-dark'`；prop 类型已写 `theme?: 'vs-dark'|'vs-light'|'novel-dark'` 但从未读取。加载遮罩、字数状态栏亦硬编码深色。
- 主进程：`electron/main/window.ts` 的 `createMainWindow` / `createSettingsWindow` 硬编码 `backgroundColor: '#1e1e1e'`；`Workspace/index.tsx` 有两处 antd `<Sider>`/`<Layout>` 硬编码 `theme="dark"`（约 493、699 行）。

## 3. 方案决策：CSS 变量

采用 **CSS 自定义属性**方案：在 `<html>` 上设 `data-theme="dark|light"`，`global.css` 为两套主题定义语义变量；组件内联样式中的 hex 替换为 `var(--xxx)`；antd 用两个 token 对象按 store 切换；Monaco 按 store 切换主题字符串。

**为何不用「主题 token hook（`useThemeColors()`）」**：每个组件都要 import+调用、切主题时全量重渲染、写法比 `var()` 啰嗦；而完整适配所需「逐文件换色」工作量两者相同，CSS 变量更简单且更易维护。

> 注：「逐文件把 hex 换成变量」是任何完整方案的不可避免工作；CSS 变量把这一步降到最机械、最低风险。

## 4. 架构

### 4.1 主题 store

在 `src/renderer/stores/index.ts` 新增 `useSettingsStore`，沿用现有 zustand+persist+localStorage 模式：

```ts
type ThemeMode = 'dark' | 'light'

interface SettingsState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      themeMode: 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
      toggleTheme: () => set({ themeMode: get().themeMode === 'dark' ? 'light' : 'dark' }),
    }),
    { name: 'settings-storage', storage: createJSONStorage(() => localStorage) }
  )
)
```

默认 `dark`（与现状一致，不改变现有用户观感）。

### 4.2 应用主题（data-theme + antd token + 无闪屏）

在 `src/renderer/index.tsx`：

1. **早执行脚本（消除冷启动闪屏）**：在 `ReactDOM.createRoot(...).render(...)` 之前，同步读取 localStorage 中的主题并设置根属性与 body 背景。zustand persist 的存储键为 `settings-storage`，值为 `{"state":{"themeMode":"..."},"version":0}`：
   ```ts
   function readPersistedTheme(): ThemeMode {
     try {
       const raw = localStorage.getItem('settings-storage')
       const mode = raw ? JSON.parse(raw)?.state?.themeMode : null
       return mode === 'light' ? 'light' : 'dark'
     } catch { return 'dark' }
   }
   const initialTheme = readPersistedTheme()
   document.documentElement.dataset.theme = initialTheme
   ```
   该赋值在首个 `<html>`/`<body>` 可见前完成，避免先渲染深色再切浅色的闪屏。

2. **React 内响应式**：把 `index.tsx` 的根组件抽成一个读取 `useSettingsStore` 的内部组件（`createRoot` 顶层不能直接调用 hook），在其内用 `useEffect` 同步 `document.documentElement.dataset.theme = themeMode`，并把对应 antd token 对象传给 `ConfigProvider`：
   ```tsx
   function Root() {
     const themeMode = useSettingsStore(s => s.themeMode)
     useEffect(() => {
       document.documentElement.dataset.theme = themeMode
     }, [themeMode])
     const antdTheme = themeMode === 'light' ? lightTheme : darkTheme
     return (
       <ConfigProvider theme={antdTheme}>
         <AntdApp><AppRouter /></AntdApp>
       </ConfigProvider>
     )
   }
   ```

### 4.3 语义调色板（global.css）

在 `global.css` 顶部用 `[data-theme="dark"]`（默认）与 `[data-theme="light"]` 两套作用域定义语义变量。**暗色沿用现状数值，不回退、不改动观感**；浅色为新设计。

| 变量 | dark（现状） | light（拟） |
|---|---|---|
| `--color-bg-base` | `#1e1e1e` | `#f5f5f5` |
| `--color-bg-elevated` | `#252526` | `#ffffff` |
| `--color-bg-container` | `#2d2d2d` | `#ffffff` |
| `--color-bg-inset` | `#252526` | `#fafafa`（列表项等微弱下沉） |
| `--color-border` | `#333333` | `#d9d9d9` |
| `--color-border-secondary` | `#444444` | `#f0f0f0` |
| `--color-text` | `#d4d4d4` | `#141414` |
| `--color-text-secondary` | `#8c8c8c` | `#595959` |
| `--color-text-tertiary` | `#6e6e6e` | `#8c8c8c` |
| `--color-primary` | `#58a6ff` | `#1677ff` |
| `--color-primary-bg` | `#0d419d` | `#1677ff`（主按钮实色） |
| `--color-primary-border` | `#1f6feb` | `#1677ff` |
| `--color-primary-hover-bg` | `#1f6feb` | `#4096ff` |
| `--color-selection-bg` | `#264f78` | `#bae0ff` |
| `--color-scrollbar-track` | `#1e1e1e` | `#f0f0f0` |
| `--color-scrollbar-thumb` | `#424242` | `#c1c1c1` |
| `--color-mask-bg` | `rgba(0,0,0,.7)` | `rgba(0,0,0,.45)` |
| `--color-danger` | `#f14c4c` | `#ff4d4f` |

> 浅色 `--color-primary` 选用 antd v5 默认 `#1677ff`，保证 antd 组件（按钮/链接/焦点环）与自定义面板视觉一致。

`global.css` 既有规则全部改吃变量：`body` 背景/文字、`::selection`、`::-webkit-scrollbar-*`，以及 `.ant-btn-primary` / `.dark-modal` / `.chapter-tree` 等 `!important` 覆盖——用变量替换硬编码 hex，使两套主题都生效。

### 4.4 antd ConfigProvider 的浅色 token

`index.tsx` 新增 `lightTheme` 对象，结构对齐 `darkTheme`（`token` + `components`），数值取自 4.3 的浅色列。关键点：
- `token.colorBgContainer/Elevated/Layout = #ffffff / #ffffff / #f5f5f5`，`colorText = #141414`，`colorBorder = #d9d9d9`，`colorPrimary = #1677ff`。
- `components`：`Layout.bodyBg=#f5f5f5, headerBg=#ffffff, siderBg=#ffffff`；`Card.colorBgContainer=#ffffff`；`Modal.colorBgElevated=#ffffff`；`Input/Select.colorBgContainer=#ffffff`；`List.colorBgContainer=#ffffff`；`Tabs.colorBgContainer=#ffffff`。
- 保留与 `darkTheme` 相同的 `fontFamily / fontSize / borderRadius`。

`Workspace/index.tsx` 两处硬编码 `theme="dark"` 直接移除该 prop，由 `ConfigProvider` token 全局驱动 Layout 背景。

### 4.5 Monaco

`MonacoEditor.tsx`：
1. 新增并注册 `novel-light`（`base: 'vs'`，`editor.background: '#ffffff'`，`editor.foreground: '#141414'`，语法 token 颜色取浅色友好值，行号/选区/缩进线对齐 4.3）。
2. `monaco.editor.create` 仍注册两套主题，但运行时主题由 store 决定。
3. 新增 effect：订阅 `themeMode`，变化时调用全局 `monaco.editor.setTheme(themeMode === 'light' ? 'novel-light' : 'novel-dark')`（该方法作用于所有已创建实例）。
4. 加载遮罩、字数状态栏的硬编码 hex 改为 `var(--xxx)`。

### 4.6 切换入口

- **设置页**：`ThemeSettings.tsx` 把 disabled 的「浅色 (开发中)」按钮接上 `useSettingsStore`：两个按钮（`深色` / `浅色`）互斥高亮（`type={themeMode===x?'primary':'default'}`），点击 `setThemeMode`；移除 `_onThemeChange` 下划线与未用 prop。本组件自身的硬编码颜色同步换 `var(--xxx)`。
- **顶栏**：在 `Home/index.tsx` 与 `Workspace/index.tsx` 的 header 内追加一个图标按钮，`themeMode==='dark' ? <SunOutlined/> : <MoonOutlined/>`，`onClick={toggleTheme}`，`style={{ WebkitAppRegion: 'no-drag' }}`。

### 4.7 BrowserWindow 背景（消除原生窗口闪屏）

主进程无法读 renderer 的 localStorage。方案（不引入新依赖）：
- `electron/main/` 新增轻量持久化：把 `themeMode` 写入 `<userData>/theme.json`（`fs.readFileSync/writeFileSync`，默认 `'dark'`）。启动时读取为模块变量 `currentTheme`。
- 新增 IPC `theme:set`（renderer 在 `setThemeMode`/`toggleTheme` 后调用）：主进程更新 `currentTheme`、写文件，并对所有现有窗口 `win.setBackgroundColor(...)`。
- `createMainWindow` / `createSettingsWindow` 用 `currentTheme` 决定 `backgroundColor`（dark→`#1e1e1e`，light→`#f5f5f5`）。

renderer 侧在 `Root` 的 effect 中（与设置 `data-theme` 同一处）顺带调用 `window.api.theme.set(themeMode)`（经 `preload` 暴露、走 `theme:set` IPC），保持单一同步入口，避免 store action 内产生副作用。

## 5. 受影响文件清单

新增：
- `lightTheme` token 对象（写在 `src/renderer/index.tsx` 内或独立 `src/renderer/styles/theme.ts`）。
- `electron/main/` 下主题持久化 + `theme:set` IPC（及 preload 暴露）。

修改：
- `src/renderer/index.tsx`：早执行脚本、`Root` 组件、双 token 切换。
- `src/renderer/stores/index.ts`：新增 `useSettingsStore`。
- `src/renderer/styles/global.css`：两套语义变量 + 全部规则改吃变量。
- `src/renderer/components/Settings/ThemeSettings.tsx`：接线 + 换色。
- `src/renderer/components/Editor/MonacoEditor.tsx`：`novel-light` + 响应式 setTheme + 换色。
- `src/renderer/pages/Home/index.tsx`、`src/renderer/pages/Workspace/index.tsx`、`src/renderer/pages/Settings/index.tsx`：顶栏切换按钮 + 全部内联 hex→var。
- 全部内联着色组件（约 14 个，含 `Dialogs/*`、`Explorer/*`、`Editor/EditorToolbar`、`Editor/OutlineView`、`Layout/EditorTabs` 等）：hex→var。
- `electron/main/window.ts`：`backgroundColor` 取自 `currentTheme`。
- `electron/main/ipc/`（或等价处）：注册 `theme:set`。

## 6. 风险与边界

- **`!important` 覆盖**：`global.css` 里 `.ant-btn-primary` 等强制色在浅色下需重新定标（如主按钮在浅色应实色蓝+白字）。逐一核对，避免浅色下按钮「深蓝底」残留。
- **Monaco 切换时机**：编辑器实例创建后才能 `setTheme`；首屏需保证注册两套主题后再依据 store 设定，避免初值错配。
- **透传遗漏**：逐文件换色工作量大，需对照「硬编码 hex 清单」逐项核对，确保无残留（残留会在浅色下表现为深色色块）。
- **原生窗口背景**：仅靠 4.7 的 `theme.json` + IPC 同步；冷启动首帧仍可能短暂为默认色，但 4.2 早执行脚本会把 renderer 首帧即设为正确色，实际无可感闪屏。
- **persist 旧数据**：现有用户 localStorage 无 `settings-storage`，`readPersistedTheme` 与 store 默认值均回落 `dark`，观感不变。

## 7. 验证

- 无测试框架（依项目既有约定：`tsc` + `lint` + `build`）。验证以手动 + 类型检查为主：
  1. `npm run dev`，在设置页切换 深色↔浅色，确认 Home、Workspace（章节树/编辑器/字数栏/大纲/设定/统计）、设置窗口、各对话框（项目/导出/命令面板/快捷键）全部正确跟随，无深色残留。
  2. 顶栏一键切换生效且图标正确（深色显示太阳、浅色显示月亮）。
  3. 刷新 / 重启 App，主题保持；冷启动无可感闪屏。
  4. Monaco 在两套主题下背景/文字/语法高亮/选区/行号正确。
  5. `tsc -p tsconfig.json`（renderer+main）无新增错误；`npm run lint` 0 error；`npm run build` 通过。
  6. grep 确认无遗漏的硬编码 hex（`src/renderer/**/*.{tsx,ts,css}` 内 `background|color|borderColor.*#[0-9a-fA-F]{3,6}`，允许 Monaco 主题定义与 antd token 对象内的颜色字面量）。

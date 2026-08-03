# Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-app light theme alongside the existing dark theme, switchable from the Settings page and a header quick-toggle, persisted across restarts with no cold-start flash.

**Architecture:** CSS custom properties drive all colors. A `data-theme` attribute on `<html>` selects one of two variable sets defined in `global.css`; a new `useSettingsStore` (zustand + localStorage) holds the choice; antd is fed one of two token objects (`darkTheme`/`lightTheme`) from a new `theme.ts`; Monaco switches between `novel-dark`/`novel-light`; the main process persists the choice to `userData/theme.json` to color native `BrowserWindow` backgrounds.

**Tech Stack:** Electron 28, React 18, antd 5, zustand 4 (+`persist`/localStorage), Monaco 0.55, electron-vite, TypeScript 5. No test framework — verification is `npm run lint` + `npm run build` + residual-hex grep + manual visual check.

## Global Constraints

**Spec:** `docs/superpowers/specs/2026-08-03-light-theme-design.md`. Every task implicitly implements part of it.

**Branch:** We are on `main`. The first step of Task 1 creates `feat/light-theme`; all work and commits land there.

**No test framework.** Each task's "test cycle" = `npm run lint` (0 errors), `npm run build` (succeeds), the per-task residual-hex grep (0 matches in the touched files, excluding legitimate color literals — see below), and a manual visual check in `npm run dev`.

**Legitimate hex (do NOT convert, will still match the grep — allow these):**
- `src/renderer/styles/theme.ts` — the `darkTheme`/`lightTheme` token objects (these *define* the colors).
- `src/renderer/components/Editor/MonacoEditor.tsx` — the `novelDarkTheme`/`novelLightTheme` rule/color definitions.
- White text on primary surfaces: `#fff`/`#ffffff` used as foreground on a blue button/modal stays as-is in both themes.

**hex → CSS variable mapping (apply mechanically in every component inline style; the variable values are defined in Task 1's `global.css` block):**

| dark hex | replace with |
|---|---|
| `#1e1e1e` | `var(--color-bg-base)` |
| `#252526` (card / sider / modal-elevated / panel) | `var(--color-bg-elevated)` |
| `#252526` (subtle inset) | `var(--color-bg-inset)` |
| `#2d2d2d` (input / list-item / static inset) | `var(--color-bg-container)` |
| `#2d2d2d` (hover state) | `var(--color-bg-hover)` |
| `#37373d` (selected) | `var(--color-bg-selected)` |
| `#333` / `#333333` | `var(--color-border)` |
| `#444` / `#444444` | `var(--color-border-secondary)` |
| `#d4d4d4` | `var(--color-text)` |
| `#888` / `#8c8c8c` | `var(--color-text-secondary)` |
| `#666` / `#6e6e6e` | `var(--color-text-tertiary)` |
| `#58a6ff` / `#1890ff` | `var(--color-primary)` |
| `#0d419d` | `var(--color-primary-bg)` |
| `#1f6feb` | `var(--color-primary-border)` |
| `rgba(24, 144, 255, 0.1)` / `rgba(88,166,255,0.12)` (active toggle bg) | `var(--color-primary-tint-bg)` |
| `#264f78` | `var(--color-selection-bg)` |
| `#424242` | `var(--color-scrollbar-thumb)` |
| `rgba(0, 0, 0, 0.7)` | `var(--color-mask-bg)` |
| `#f14c4c` / `#ff4d4f` | `var(--color-danger)` |
| `#000000` (only in `.dark-modal` rules) | scope the whole rule under `[data-theme="dark"]` (Task 4) — do not use a variable |

When a single hex could map two ways (e.g. `#2d2d2d` as container vs. hover), pick by the element's role: hover/active states → `--color-bg-hover`; static inset surfaces → `--color-bg-container`.

**Commit style:** conventional commits with `feat(theme):` / `style(theme):` scope, one per task.

---

### Task 1: Theme foundation (store, tokens, index.tsx wiring, CSS variable definitions)

**Files:**
- Create: `src/renderer/styles/theme.ts`
- Modify: `src/renderer/stores/index.ts` (append `useSettingsStore`)
- Modify: `src/renderer/index.tsx`
- Modify: `src/renderer/styles/global.css` (prepend variable definitions only — existing rules are converted in Task 4)

**Interfaces:**
- Produces: `useSettingsStore` (zustand) with `{ themeMode: 'dark'|'light', setThemeMode, toggleTheme }`, persisted as `settings-storage`. `ThemeMode` type exported from `theme.ts`. `darkTheme`/`lightTheme` antd theme objects and `readPersistedTheme()` exported from `theme.ts`.

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/light-theme
```

- [ ] **Step 2: Create `src/renderer/styles/theme.ts`** — move the existing `darkTheme` object out of `index.tsx` verbatim, add `lightTheme`, the `ThemeMode` type, and `readPersistedTheme`:

```ts
import type { ThemeConfig } from 'antd'

export type ThemeMode = 'dark' | 'light'

// 深色主题 token（现状，原样搬迁自 index.tsx，不改动观感）
export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: '#58a6ff',
    colorBgContainer: '#1e1e1e',
    colorBgElevated: '#252526',
    colorBgLayout: '#1e1e1e',
    colorText: '#d4d4d4',
    colorTextSecondary: '#8c8c8c',
    colorTextTertiary: '#6e6e6e',
    colorBorder: '#333333',
    colorBorderSecondary: '#2d2d2d',
    colorIcon: '#8c8c8c',
    colorIconHover: '#d4d4d4',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    borderRadius: 4,
  },
  components: {
    Layout: { headerBg: '#1e1e1e', siderBg: '#252526', bodyBg: '#1e1e1e' },
    Card: { colorBgContainer: '#252526', colorBorderSecondary: '#333333' },
    Modal: { colorBgElevated: '#252526', colorBgContainer: '#1e1e1e' },
    Button: { colorPrimaryBg: '#58a6ff' },
    Input: { colorBgContainer: '#2d2d2d', colorBorder: '#333333' },
    Select: { colorBgContainer: '#2d2d2d', colorBorder: '#333333' },
    List: { colorBgContainer: '#2d2d2d' },
    Tabs: { colorBgContainer: '#252526', colorActiveBar: '#58a6ff' },
  },
}

// 浅色主题 token（新增）
export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f5f5',
    colorText: '#141414',
    colorTextSecondary: '#595959',
    colorTextTertiary: '#8c8c8c',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
    colorIcon: '#595959',
    colorIconHover: '#141414',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    borderRadius: 4,
  },
  components: {
    Layout: { headerBg: '#ffffff', siderBg: '#ffffff', bodyBg: '#f5f5f5' },
    Card: { colorBgContainer: '#ffffff', colorBorderSecondary: '#f0f0f0' },
    Modal: { colorBgElevated: '#ffffff', colorBgContainer: '#ffffff' },
    Button: { colorPrimaryBg: '#1677ff' },
    Input: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9' },
    Select: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9' },
    List: { colorBgContainer: '#ffffff' },
    Tabs: { colorBgContainer: '#ffffff', colorActiveBar: '#1677ff' },
  },
}

// 在 React 挂载前同步读取持久化主题，避免冷启动闪屏
export function readPersistedTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem('settings-storage')
    const mode = raw ? JSON.parse(raw)?.state?.themeMode : null
    return mode === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
```

- [ ] **Step 3: Add `useSettingsStore` to `src/renderer/stores/index.ts`** — append after `useShortcutStore` (end of file), following the existing zustand+persist pattern:

```ts
// 应用设置（主题等）
interface SettingsState {
  themeMode: 'dark' | 'light'
  setThemeMode: (mode: 'dark' | 'light') => void
  toggleTheme: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      themeMode: 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
      toggleTheme: () => set({ themeMode: get().themeMode === 'dark' ? 'light' : 'dark' }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
```

- [ ] **Step 4: Rewire `src/renderer/index.tsx`** — replace the entire file. Adds an early no-flash script, a `Root` component that reads the store and switches the antd theme + `data-theme` attribute:

```tsx
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import AppRouter from './App'
import { useSettingsStore } from './stores'
import { darkTheme, lightTheme, readPersistedTheme } from './styles/theme'
import './styles/global.css'

// 冷启动：在 React 挂载前同步设置根主题属性，避免闪屏
document.documentElement.dataset.theme = readPersistedTheme()

function Root() {
  const themeMode = useSettingsStore((s) => s.themeMode)

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  const antdTheme = themeMode === 'light' ? lightTheme : darkTheme

  return (
    <React.StrictMode>
      <ConfigProvider theme={antdTheme}>
        <AntdApp>
          <AppRouter />
        </AntdApp>
      </ConfigProvider>
    </React.StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
```

- [ ] **Step 5: Prepend CSS variable definitions to `src/renderer/styles/global.css`** — insert at the very top of the file (above the existing `* { }` rule). Do not touch existing rules yet (Task 4 converts them):

```css
:root,
[data-theme='dark'] {
  --color-bg-base: #1e1e1e;
  --color-bg-elevated: #252526;
  --color-bg-container: #2d2d2d;
  --color-bg-hover: #2d2d2d;
  --color-bg-selected: #37373d;
  --color-bg-inset: #252526;
  --color-border: #333333;
  --color-border-secondary: #444444;
  --color-text: #d4d4d4;
  --color-text-secondary: #8c8c8c;
  --color-text-tertiary: #6e6e6e;
  --color-primary: #58a6ff;
  --color-primary-bg: #0d419d;
  --color-primary-border: #1f6feb;
  --color-primary-tint-bg: rgba(88, 166, 255, 0.12);
  --color-selection-bg: #264f78;
  --color-scrollbar-track: #1e1e1e;
  --color-scrollbar-thumb: #424242;
  --color-mask-bg: rgba(0, 0, 0, 0.7);
  --color-danger: #f14c4c;
}

[data-theme='light'] {
  --color-bg-base: #f5f5f5;
  --color-bg-elevated: #ffffff;
  --color-bg-container: #ffffff;
  --color-bg-hover: #f5f5f5;
  --color-bg-selected: #e6f4ff;
  --color-bg-inset: #fafafa;
  --color-border: #d9d9d9;
  --color-border-secondary: #f0f0f0;
  --color-text: #141414;
  --color-text-secondary: #595959;
  --color-text-tertiary: #8c8c8c;
  --color-primary: #1677ff;
  --color-primary-bg: #1677ff;
  --color-primary-border: #1677ff;
  --color-primary-tint-bg: rgba(22, 119, 255, 0.1);
  --color-selection-bg: #bae0ff;
  --color-scrollbar-track: #f0f0f0;
  --color-scrollbar-thumb: #c1c1c1;
  --color-mask-bg: rgba(0, 0, 0, 0.45);
  --color-danger: #ff4d4f;
}
```

- [ ] **Step 6: Verify (lint + build + manual)**

```bash
npm run lint
npm run build
```
Expected: lint 0 errors; build succeeds. Then `npm run dev`: the app boots in dark with unchanged appearance. Because the clickable toggle arrives in Task 2, verify the store+token plumbing via the console: open DevTools and run
```js
localStorage.setItem('settings-storage', JSON.stringify({ state: { themeMode: 'light' }, version: 0 }))
```
then reload the window (Ctrl+R). antd components (the 新建项目 / 打开项目 primary buttons, the empty-state card) must render in the light palette, and `<html>` must have `data-theme="light"`. Set the value back to `"dark"` and reload to confirm dark returns.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles/theme.ts src/renderer/stores/index.ts src/renderer/index.tsx src/renderer/styles/global.css
git commit -m "feat(theme): add theme store, light/dark antd tokens, and CSS variable foundation"
```

---

### Task 2: ThemeToggle component + Home page (full conversion) + Settings wiring

**Files:**
- Create: `src/renderer/components/ThemeToggle.tsx`
- Modify: `src/renderer/pages/Home/index.tsx` (add toggle to header + convert ALL inline hex per the mapping)
- Modify: `src/renderer/components/Settings/ThemeSettings.tsx` (wire the two buttons to the store + convert ALL inline hex per the mapping)

**Interfaces:**
- Produces: `<ThemeToggle />` — a self-contained icon button (sun in dark mode, moon in light mode) that calls `useSettingsStore.toggleTheme`; accepts an optional `size` prop; styled with CSS variables so it works in both themes.

- [ ] **Step 1: Create `src/renderer/components/ThemeToggle.tsx`**

```tsx
import React from 'react'
import { Button, Tooltip } from 'antd'
import { SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../stores'

interface ThemeToggleProps {
  size?: 'small' | 'middle' | 'large'
}

function ThemeToggle({ size = 'small' }: ThemeToggleProps) {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const isDark = themeMode === 'dark'

  return (
    <Tooltip title={isDark ? '切换到浅色' : '切换到深色'}>
      <Button
        type="text"
        size={size}
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggleTheme}
        style={{ color: 'var(--color-text)', WebkitAppRegion: 'no-drag' }}
      />
    </Tooltip>
  )
}

export default ThemeToggle
```

- [ ] **Step 2: Add `<ThemeToggle />` to the Home header and convert all of Home's inline hex**

In `src/renderer/pages/Home/index.tsx`:
1. Add import: `import ThemeToggle from '../../components/ThemeToggle'`.
2. In the header `<Space size="small">` (the one containing 新建项目 / 打开项目 buttons, around lines 67–96), append `<ThemeToggle />` as the last child (after the 打开项目 button).
3. Replace every hardcoded hex in this file's inline styles using the Global Constraints mapping table. The values present include: `#1e1e1e`→`var(--color-bg-base)`, `#333`→`var(--color-border)`, `#0d419d`→`var(--color-primary-bg)`, `#1f6feb`→`var(--color-primary-border)`, `#2d2d2d`→`var(--color-bg-container)`, `#444`→`var(--color-border-secondary)`, `#d4d4d4`→`var(--color-text)`, `#58a6ff`→`var(--color-primary)`, `#888`→`var(--color-text-secondary)`. Leave `#fff` on the primary buttons as-is.

- [ ] **Step 3: Wire `ThemeSettings.tsx` buttons to the store and convert its inline hex**

In `src/renderer/components/Settings/ThemeSettings.tsx`:
1. Replace imports: add `import { useSettingsStore } from '../../stores'` and `import ThemeToggle is NOT needed here`. Remove the unused `onThemeChange` prop entirely (delete `ThemeSettingsProps` and the `_onThemeChange` destructure; the component takes no props — update its call site in `src/renderer/pages/Settings/index.tsx` only if it passes props; check and remove any props passed).
2. Inside the component, read `const { themeMode, setThemeMode } = useSettingsStore()`.
3. Replace the 主题 button block (the `深色` button + disabled `浅色 (开发中)` button) with two mutually-exclusive buttons:
```tsx
<Space>
  <Button
    type={themeMode === 'dark' ? 'primary' : 'default'}
    onClick={() => setThemeMode('dark')}
  >
    深色
  </Button>
  <Button
    type={themeMode === 'light' ? 'primary' : 'default'}
    onClick={() => setThemeMode('light')}
  >
    浅色
  </Button>
</Space>
```
4. Convert every hardcoded hex in this file's inline styles per the mapping (`#888`→secondary, `#d4d4d4`→text, `#333`→border, `#1e1e1e`→bg-base). The `BgColorsOutlined`/`FontSizeOutlined`/etc. icon colors `#888`→`var(--color-text-secondary)`.

- [ ] **Step 4: Verify**

```bash
npm run lint
npm run build
```
Then `npm run dev`: open the app → Home header shows a sun icon; click it → antd components switch to light, click again → dark. Open Settings window → 主题 shows two buttons, selecting each switches the theme live. Run the residual-hex grep for these two files:
```bash
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/pages/Home/index.tsx' 'src/renderer/components/Settings/ThemeSettings.tsx'
```
Expected: 0 matches.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ThemeToggle.tsx src/renderer/pages/Home/index.tsx src/renderer/components/Settings/ThemeSettings.tsx src/renderer/pages/Settings/index.tsx
git commit -m "feat(theme): add ThemeToggle, wire Settings theme buttons, convert Home to CSS vars"
```

---

### Task 3: Workspace + EditorToolbar (toggle, remove `theme="dark"`, full hex→var conversion)

**Files:**
- Modify: `src/renderer/components/Editor/EditorToolbar.tsx` (add `<ThemeToggle />` in the right-side `<Space>` + convert all inline hex)
- Modify: `src/renderer/pages/Workspace/index.tsx` (remove both `theme="dark"` props + convert all inline hex)

**Interfaces:**
- Consumes: `<ThemeToggle />` from Task 2.

- [ ] **Step 1: Add `<ThemeToggle />` to `EditorToolbar.tsx` and convert its hex**

In `src/renderer/components/Editor/EditorToolbar.tsx`:
1. Add imports: `import ThemeToggle from '../ThemeToggle'`.
2. In the right-side `<Space size="small">` (the one with 专注/打字机/导出/保存), insert `<ThemeToggle />` immediately before the 字数统计 `<span>` (after the save `Tooltip`).
3. Convert every inline hex per the mapping. Note specifically: `#252526`→`var(--color-bg-elevated)` (toolbar bg), `#333`→border, `#1e1e1e`→bg-base (title input bg), `#d4d4d4`→text, `#444`→border-secondary (dividers), `#888`→text-secondary, `#1890ff`→`var(--color-primary)` (active toggle color), `rgba(24, 144, 255, 0.1)`→`var(--color-primary-tint-bg)` (active toggle bg).

- [ ] **Step 2: Remove both `theme="dark"` and convert all inline hex in `Workspace/index.tsx`**

In `src/renderer/pages/Workspace/index.tsx`:
1. Delete the `theme="dark"` prop on the left `<Sider>` (line ~493) and on the outline `<Sider>` (line ~699). The Layout background is now driven by the antd token via `ConfigProvider`.
2. Convert every inline hex in this file per the mapping (`#1e1e1e`→bg-base, `#252526`→elevated, `#333`→border, `#d4d4d4`→text, `#888`/`#666`→secondary/tertiary, `#58a6ff`→primary, `#0d419d`→primary-bg, `#1f6feb`→primary-border, `#2d2d2d`→container, `#444`→border-secondary, `#fff` on primary buttons stays).

- [ ] **Step 3: Verify**

```bash
npm run lint
npm run build
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/components/Editor/EditorToolbar.tsx' 'src/renderer/pages/Workspace/index.tsx'
```
Expected: lint 0, build ok, grep 0 matches. Then `npm run dev`: open a project; the toolbar shows the toggle; both themes render the sidebar/outline/editor area correctly with no dark clamps.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Editor/EditorToolbar.tsx src/renderer/pages/Workspace/index.tsx
git commit -m "feat(theme): add workspace toggle, drop hardcoded Layout theme, convert to CSS vars"
```

---

### Task 4: Convert all remaining `global.css` rules to variables / theme-scoped

**Files:**
- Modify: `src/renderer/styles/global.css` (every rule below the variable block added in Task 1)

- [ ] **Step 1: Replace hardcoded hex in shared rules with variables**

Apply the mapping to these rules (they must work in both themes):
- `body { background-color/color }` → `var(--color-bg-base)` / `var(--color-text)`
- `::-webkit-scrollbar-track` → `var(--color-scrollbar-track)`
- `::-webkit-scrollbar-thumb` (+ `:hover` `#4f4f4f`→keep as a hover variant: use `var(--color-scrollbar-thumb)` for base and a slightly stronger value for hover — simplest: set `:hover` to `var(--color-text-tertiary)`)
- `::selection` → background `var(--color-selection-bg)`, color `#ffffff` stays
- `.ant-input::placeholder` color `#666` → `var(--color-text-tertiary)`
- `.ant-modal .ant-modal-close` color `#888`→`var(--color-text-secondary)`, `:hover` `#d4d4d4`→`var(--color-text)`
- `.chapter-tree` and descendants: `#252526`→`var(--color-bg-elevated)`, `#2d2d2d`(hover)→`var(--color-bg-hover)`, `#37373d`(selected)→`var(--color-bg-selected)`, `#d4d4d4`→text, `#58a6ff`→primary, `#888`→secondary, `#fff` stays, `.chapter-tree-header` border `#333`→border, `.ant-btn-dashed` border `#444`/color `#888` and hover `#58a6ff` per mapping.

- [ ] **Step 2: Scope dark-only `!important` rules under `[data-theme='dark']`**

These force a dark look and must NOT apply in light (light falls back to antd defaults, which are already correct). Wrap each selector with `[data-theme='dark']`:
- `.ant-btn-primary` (and its `:hover/:focus/:active`) — currently forces `#0d419d`/`#1f6feb`. Becomes `[data-theme='dark'] .ant-btn-primary { ... }`.
- `.dark-modal .ant-modal-content`, `.dark-modal .ant-modal-header`, `.dark-modal .ant-modal-body`, `.dark-modal .ant-modal-footer`, `.dark-modal + .ant-modal-mask`, and the `.dark-modal.ant-modal.confirm ...` family — all the `#000000` / `#ffffff` / `#0d419d` / `#2d2d2d` rules. Prefix each selector with `[data-theme='dark']` (e.g. `[data-theme='dark'] .dark-modal .ant-modal-content { ... }`). The `.dark-modal` class is applied to the error modal in `ProjectDialog.tsx`; in light theme it will use antd's default light modal styling.

> Note: `#ff4d4f` in `.dark-modal.ant-modal.confirm .ant-modal-body > .anticon` is the danger icon color — keep it `var(--color-danger)`.

- [ ] **Step 3: Verify**

```bash
npm run build
git grep -nE "#[0-9a-fA-F]{3,6}" -- 'src/renderer/styles/global.css'
```
Expected: the grep now returns ONLY the variable-definition block at the top (the `:root`/`[data-theme]` assignments) — no hex inside the rule bodies. Then `npm run dev`: scrollbars, text selection, chapter tree, primary buttons, and the error modal all look correct in BOTH themes (toggle via the header button).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/global.css
git commit -m "style(theme): convert global.css to CSS variables, scope dark overrides under data-theme"
```

---

### Task 5: Monaco light theme + reactive switching

**Files:**
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` from Task 1.

- [ ] **Step 1: Add the `novelLightTheme` definition**

In `src/renderer/components/Editor/MonacoEditor.tsx`, immediately after the existing `novelDarkTheme` const (after line 32), add:

```ts
const novelLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: '', foreground: '141414' },
    { token: 'heading', foreground: '1677ff', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c41d7f' },
    { token: 'string', foreground: '389e0d' },
    { token: 'comment', foreground: '8c8c8c' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#141414',
    'editor.lineHighlightBackground': '#fafafa',
    'editor.selectionBackground': '#bae0ff',
    'editorCursor.foreground': '#1677ff',
    'editorLineNumber.foreground': 'bfbfbf',
    'editorLineNumber.activeForeground': '595959',
    'editor.inactiveSelectionBackground': '#e6f4ff',
    'editorIndentGuide.background': '#f0f0f0',
    'editorIndentGuide.activeBackground': '#d9d9d9',
  },
}
```

- [ ] **Step 2: Register both themes; subscribe the editor to the theme store**

1. Add the import: `import { useSettingsStore } from '../../stores'`.
2. Inside the component, add: `const themeMode = useSettingsStore((s) => s.themeMode)`.
3. In the `initMonaco` effect, after `monaco.editor.defineTheme('novel-dark', novelDarkTheme)` (line ~117), add: `monaco.editor.defineTheme('novel-light', novelLightTheme)`.
4. Change the `monaco.editor.create(...)` option `theme: 'novel-dark'` (line ~123) to `theme: themeMode === 'light' ? 'novel-light' : 'novel-dark'`. Add `themeMode` to that effect's dependency array is NOT needed for init (init runs once) — the reactive switch is the next step.
5. Add a NEW effect (after the other update effects, e.g. after the `showLineNumbers` effect) that reactively switches the theme:
```tsx
// 跟随全局主题切换编辑器主题
useEffect(() => {
  if (monaco) {
    monaco.editor.setTheme(themeMode === 'light' ? 'novel-light' : 'novel-dark')
  }
}, [themeMode])
```

- [ ] **Step 3: Convert the loader overlay + word-count bar inline hex**

- Loader overlay `background: '#1e1e1e'` → `var(--color-bg-base)`, `color: '#888'` → `var(--color-text-secondary)`.
- Word-count bar `background: '#252526'` → `var(--color-bg-elevated)`, `borderTop: '1px solid #333'` → `1px solid var(--color-border)`, `color: '#888'` → `var(--color-text-secondary)`.

- [ ] **Step 4: Verify**

```bash
npm run lint
npm run build
```
Then `npm run dev`: open a project + chapter so the editor mounts; toggle the theme via the header button — the editor background, text, line numbers, selection, and syntax tokens switch between dark and light live, with no reload. The loader and word-count bar also follow.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Editor/MonacoEditor.tsx
git commit -m "feat(theme): add novel-light Monaco theme and reactive editor switching"
```

---

### Task 6: Native window background — persist theme in main process

**Files:**
- Create: `electron/main/theme.ts`
- Modify: `electron/main/index.ts` (call `loadTheme()` before window creation)
- Modify: `electron/main/ipc/handlers.ts` (register `theme:set` handler)
- Modify: `electron/main/window.ts` (use theme-derived `backgroundColor` + titleBarOverlay)
- Modify: `src/renderer/services/ipcService.ts` (add `setThemeMode` wrapper)

**Interfaces:**
- Produces: main-process `loadTheme()`, `getThemeBackgroundColor()`, `getThemeTitleBarColor()`, `getThemeTitleBarSymbolColor()`, `setCurrentTheme(mode)` in `electron/main/theme.ts`; renderer `setThemeMode(mode)` IPC wrapper. The preload needs NO change — the generic `electronAPI.invoke('theme:set', mode)` passthrough already exists.

- [ ] **Step 1: Create `electron/main/theme.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export type ThemeMode = 'dark' | 'light'

const themeFilePath = (): string => path.join(app.getPath('userData'), 'theme.json')

let currentTheme: ThemeMode = 'dark'

// 启动时从 userData/theme.json 读取持久化主题
export function loadTheme(): void {
  try {
    const raw = fs.readFileSync(themeFilePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    currentTheme = parsed?.mode === 'light' ? 'light' : 'dark'
  } catch {
    currentTheme = 'dark'
  }
}

export function getCurrentTheme(): ThemeMode {
  return currentTheme
}

export function getThemeBackgroundColor(): string {
  return currentTheme === 'light' ? '#f5f5f5' : '#1e1e1e'
}

export function getThemeTitleBarColor(): string {
  return currentTheme === 'light' ? '#ffffff' : '#252526'
}

export function getThemeTitleBarSymbolColor(): string {
  return currentTheme === 'light' ? '#000000' : '#ffffff'
}

// 渲染进程切换主题时：更新内存值、落盘、刷新所有已开窗口
export function setCurrentTheme(mode: ThemeMode): void {
  currentTheme = mode
  try {
    fs.writeFileSync(themeFilePath(), JSON.stringify({ mode }), 'utf-8')
  } catch (e) {
    console.error('Failed to persist theme:', e)
  }
  const bgColor = getThemeBackgroundColor()
  const titleColor = getThemeTitleBarColor()
  const symbolColor = getThemeTitleBarSymbolColor()
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bgColor)
    // setTitleBarOverlay 仅 Windows 生效，其他平台静默忽略
    win.setTitleBarOverlay?.({ color: titleColor, symbolColor })
  }
}
```

- [ ] **Step 2: Call `loadTheme()` at startup in `electron/main/index.ts`**

Add import and call inside `app.whenReady().then(...)` BEFORE `createMainWindow()`:
```ts
import { loadTheme } from './theme'
// ...
app.whenReady().then(() => {
  loadTheme()
  createMainWindow()
  // ...rest unchanged
})
```

- [ ] **Step 3: Register the `theme:set` handler in `electron/main/ipc/handlers.ts`**

Add imports at top: `import { setCurrentTheme } from '../theme'`. Add the handler (anywhere among the other `ipcMain.handle` calls):
```ts
ipcMain.handle('theme:set', (_event, mode: 'dark' | 'light') => {
  setCurrentTheme(mode)
  return true
})
```

- [ ] **Step 4: Use theme-derived colors in `electron/main/window.ts`**

Add import: `import { getThemeBackgroundColor, getThemeTitleBarColor, getThemeTitleBarSymbolColor } from './theme'`.
- In `createMainWindow` `browserOptions`: replace `backgroundColor: '#1e1e1e'` with `backgroundColor: getThemeBackgroundColor()`; in `titleBarOverlay` replace `color: '#252526'` with `color: getThemeTitleBarColor()` and `symbolColor: '#ffffff'` with `symbolColor: getThemeTitleBarSymbolColor()`.
- In `createSettingsWindow` `browserOptions`: apply the same three replacements.

- [ ] **Step 5: Add the renderer IPC wrapper in `src/renderer/services/ipcService.ts`**

In the 「事件监听」or a new 「主题」section, add:
```ts
// ==================== 主题相关 ====================

export function setThemeMode(mode: 'dark' | 'light'): Promise<boolean> {
  return invoke<boolean>('theme:set', mode)
}
```

- [ ] **Step 6: Call `setThemeMode` from the `Root` effect in `src/renderer/index.tsx`**

Update the effect in `Root` (from Task 1) to also notify the main process:
```tsx
import { setThemeMode as setThemeModeIPC } from './services/ipcService'
// ...
useEffect(() => {
  document.documentElement.dataset.theme = themeMode
  setThemeModeIPC(themeMode)
}, [themeMode])
```

- [ ] **Step 7: Verify**

```bash
npm run lint
npm run build
```
Then `npm run dev`: toggle to light, fully quit the app (not just close window — quit via tray/menu), relaunch — the native window opens light from the first frame (no dark flash), and `<userData>/theme.json` contains `{"mode":"light"}`. Toggle to dark, quit, relaunch — opens dark. Open the Settings window in both themes — its native background matches.

- [ ] **Step 8: Commit**

```bash
git add electron/main/theme.ts electron/main/index.ts electron/main/ipc/handlers.ts electron/main/window.ts src/renderer/services/ipcService.ts src/renderer/index.tsx
git commit -m "feat(theme): persist theme in main process for native window background"
```

---

### Task 7: Dialogs hex→var sweep

**Files:**
- Modify: `src/renderer/components/Dialogs/ProjectDialog.tsx`
- Modify: `src/renderer/components/Dialogs/CommandPalette.tsx`
- Modify: `src/renderer/components/Dialogs/ExportDialog.tsx`
- Modify: `src/renderer/components/Dialogs/ShortcutDialog.tsx`

- [ ] **Step 1: Convert all inline hex in each file** per the Global Constraints mapping table. These files use the standard palette (`#1e1e1e`, `#252526`, `#2d2d2d`, `#333`, `#444`, `#d4d4d4`, `#888`, `#58a6ff`, `#0d419d`, `#1f6feb`, `#000000`).
  - Note for `ProjectDialog.tsx`: the error modal uses `className="dark-modal"` and forces `#000000` backgrounds inline (the `styles.content/header/body/mask` objects). These inline `#000000` must become theme-aware: replace `#000000`→`var(--color-bg-elevated)` won't match the dark-modal intent. Instead: in dark the error modal is near-black; in light it should be light. Simplest correct fix — replace those inline `#000000` with `var(--color-bg-elevated)` and the inline text `#ffffff` with `var(--color-text)`; drop reliance on the `.dark-modal` CSS overrides for color (Task 4 scoped those to dark only, so in light the inline `var()` values apply and look correct). Verify the error modal visually in both themes by triggering it (select a non-project folder in 打开项目).

- [ ] **Step 2: Verify**

```bash
npm run lint
npm run build
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/components/Dialogs/'
```
Expected: lint 0, build ok, grep 0 matches. Then `npm run dev`: open each dialog (新建项目, 打开项目, 命令面板 Ctrl+Shift+P, 导出, 快捷键) in both themes — all render correctly.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/Dialogs/
git commit -m "style(theme): convert dialog components to CSS variables"
```

---

### Task 8: Explorer / Editor / Layout hex→var sweep

**Files:**
- Modify: `src/renderer/components/Explorer/ChapterTree.tsx`
- Modify: `src/renderer/components/Explorer/StatsPanel.tsx`
- Modify: `src/renderer/components/Explorer/SettingPanel.tsx`
- Modify: `src/renderer/components/Explorer/CharacterPanel.tsx`
- Modify: `src/renderer/components/Editor/OutlineView.tsx`
- Modify: `src/renderer/components/Layout/EditorTabs.tsx`

- [ ] **Step 1: Convert all inline hex in each file** per the mapping table. `StatsPanel.tsx` has the most (~26 inline usages, including chart/stat-tile colors) — map stat accent colors to `var(--color-primary)`, backgrounds to the bg-* vars, text to text-* vars. Watch for `#37373d` (selected)→`var(--color-bg-selected)`, hover `#2d2d2d`→`var(--color-bg-hover)`.

- [ ] **Step 2: Verify**

```bash
npm run lint
npm run build
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/components/Explorer/' 'src/renderer/components/Editor/OutlineView.tsx' 'src/renderer/components/Layout/EditorTabs.tsx'
```
Expected: 0 matches. Then `npm run dev`: in a project, exercise the chapter tree, the stats panel, the 设定 panel, the 角色 panel, the outline view, and editor tabs in both themes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/Explorer/ src/renderer/components/Editor/OutlineView.tsx src/renderer/components/Layout/EditorTabs.tsx
git commit -m "style(theme): convert explorer/editor-tabs/outline components to CSS variables"
```

---

### Task 9: Settings page hex→var sweep

**Files:**
- Modify: `src/renderer/pages/Settings/index.tsx`

- [ ] **Step 1: Convert all inline hex** in `src/renderer/pages/Settings/index.tsx` per the mapping table (`ThemeSettings.tsx` was already done in Task 2; this is the page shell + shortcuts section).

- [ ] **Step 2: Verify**

```bash
npm run lint
npm run build
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/pages/Settings/index.tsx'
```
Expected: 0 matches. Then `npm run dev`: open the Settings window in both themes — the full page (theme section, font-size, editor options, shortcuts) renders correctly.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/Settings/index.tsx
git commit -m "style(theme): convert Settings page to CSS variables"
```

---

### Task 10: Final verification + docs

**Files:**
- Modify: `README.md` (progress table, stage 9 / theming note)
- Modify: `docs/DEVELOPMENT.md` (progress table) — only if it tracks this feature

- [ ] **Step 1: Repo-wide residual-hex audit (component/page layer)**

```bash
git grep -nE "(background|color|borderColor|backgroundColor|borderTop|borderBottom|borderLeft|borderLeftColor)[: ].*'#[0-9a-fA-F]{3,6}'" -- 'src/renderer/**/*.tsx' 'src/renderer/**/*.ts'
```
Expected: 0 matches. If any remain, convert them per the mapping. (Allowed hex lives only in `src/renderer/styles/theme.ts` and the Monaco theme consts in `MonacoEditor.tsx` — neither matches this grep's property pattern in a way that needs fixing; confirm by inspecting any hits.)

- [ ] **Step 2: Full build + lint gate**

```bash
npm run lint
npm run build
```
Expected: lint 0 errors; build succeeds.

- [ ] **Step 3: Manual visual checklist (both themes)**

`npm run dev`, then in BOTH dark and light verify:
- [ ] Home: header (toggle icon correct), 最近项目 card, 开始创作 card, project dialogs.
- [ ] Workspace: sidebar (chapter tree), toolbar (all icon buttons, title input, dividers), editor (Monaco bg/text/selection/line numbers/syntax), word-count bar, outline sider, empty-state.
- [ ] Settings window: theme buttons (correct active state), font size, editor options, shortcuts.
- [ ] Dialogs: 新建/打开项目, 导出, 命令面板, 快捷键, invalid-folder error modal.
- [ ] Globals: scrollbars, text selection color, primary buttons, modal mask.
- [ ] Persistence: toggle, quit the app fully, relaunch — correct theme with no flash.

- [ ] **Step 4: Update docs**

Update the progress table in `README.md` (and `docs/DEVELOPMENT.md` if it lists this): mark theming / stage-9 adjacent item as complete, note the new `useSettingsStore`, `data-theme` mechanism, and the `theme.json` persistence. Keep claims accurate (no over-claiming).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/DEVELOPMENT.md
git commit -m "docs: record light theme completion and theming mechanism"
```

- [ ] **Step 6: Merge (with user approval)**

This step is gated on the finishing-a-development-branch flow — do not merge automatically. When the user approves, merge `feat/light-theme` into `main` (or open a PR).

---

## Self-Review (completed during authoring)

**Spec coverage:** §4.1 store → Task 1; §4.2 data-theme + antd token + no-flash → Task 1; §4.3 palette → Task 1 (vars) + Task 4 (rules); §4.4 antd light token → Task 1; §4.5 Monaco → Task 5; §4.6 toggle UX (settings + header) → Tasks 2–3; §4.7 BrowserWindow bg → Task 6; §5 file list → Tasks 1–9; §6 risks (`.dark-modal`, Monaco timing, residual hex, native bg, persist default) → addressed in Tasks 4, 5, 7, 6, 1; §7 verification → every task + Task 10.

**Placeholder scan:** each code/convert step contains the actual mapping or code; no "TODO"/"implement later". The two `git grep` verification commands are exact.

**Type/name consistency:** `useSettingsStore` (Task 1) consumed identically in Tasks 2, 3, 5; `<ThemeToggle />` (Task 2) consumed in Task 3; `readPersistedTheme`/`darkTheme`/`lightTheme`/`ThemeMode` (Task 1) consistent throughout; main-process `setCurrentTheme`/`loadTheme`/`getTheme*` (Task 6) match across `theme.ts`, `handlers.ts`, `window.ts`, `index.ts`; renderer `setThemeMode` (Task 6) matches the `Root` effect call.

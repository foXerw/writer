# 批次 4 实现计划：快捷键自定义（Shortcut Customization）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 快捷键用户自定义绑定 + 冲突检测（审计阶段15 两项缺失目标）。

**Architecture:** 新建 `shortcutService.ts`（`Combo`/`ShortcutDef`/`DEFAULT_SHORTCUTS` + 纯函数）；`useShortcutStore` 持久化 overrides（应用级 localStorage）；`useKeyboard` 重构为合并默认+覆盖、id→action；新建 `ShortcutDialog`（列表+捕获 rebind+冲突阻断+重置），App 渲染一次；菜单 `'shortcuts'` 与 Settings 按钮入口。

**Tech Stack:** Electron + React 18 + TS + antd 5 + Zustand。无测试框架；无新依赖。

## Global Constraints

- **无单元测试框架**：每任务验证 = `npx tsc --noEmit`（被改文件不引入新错误，基线约 54）+ `npm run build` + 手动冒烟。子代理无法驱动 Electron GUI；手动冒烟由人完成。
- **不引入新依赖**；**不改主进程/preload**；**不动 CommandPalette**。
- **分支**：`feat/shortcut-customization`（已创建，spec 提交于 `7627da4`）。
- 提交规范：Conventional Commits，中文，末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。

## 文件结构

| 文件 | 责任 | 任务 |
|------|------|------|
| `src/renderer/services/shortcutService.ts` | **新建**：类型、`DEFAULT_SHORTCUTS`、纯函数 | Task 1 |
| `src/renderer/stores/index.ts` | 新增 `useShortcutStore` | Task 2 |
| `src/renderer/hooks/useKeyboard.ts` | 重构：合并 overrides + id→action | Task 3 |
| `src/renderer/components/Dialogs/ShortcutDialog.tsx` | **新建**：列表+捕获+冲突+重置 | Task 4 |
| `src/renderer/App.tsx` | 渲染 `<ShortcutDialog />` 一次 | Task 5 |
| `src/renderer/pages/Workspace/index.tsx` | `useMenu` 加 `'shortcuts'` | Task 5 |
| `src/renderer/pages/Settings/index.tsx` | 加「快捷键」分区 + 按钮 | Task 5 |
| `docs/AUDIT.md` / `README.md` / `docs/DEVELOPMENT.md` | 阶段15 状态 | Task 6 |

---

## Task 1: shortcutService.ts（类型 + 默认 + 纯函数）

**Files:** Create `src/renderer/services/shortcutService.ts`

- [ ] **Step 1: 创建文件**

```ts
export interface Combo {
  key: string         // 字母小写 's' 或键名 'F8'/'Escape'/'ArrowUp'
  ctrl?: boolean      // 捕获时 ctrl||meta 归一为 ctrl
  shift?: boolean
  alt?: boolean
  meta?: boolean
}
export interface ShortcutDef { id: string; combo: Combo; description: string }

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: 'save',           description: '保存',         combo: { key: 's', ctrl: true } },
  { id: 'saveAll',        description: '保存全部',     combo: { key: 's', ctrl: true, shift: true } },
  { id: 'new',            description: '新建',         combo: { key: 'n', ctrl: true } },
  { id: 'open',           description: '打开',         combo: { key: 'o', ctrl: true } },
  { id: 'undo',           description: '撤销',         combo: { key: 'z', ctrl: true } },
  { id: 'redo',           description: '重做',         combo: { key: 'y', ctrl: true } },
  { id: 'toggleSidebar',  description: '切换侧边栏',   combo: { key: 'b', ctrl: true } },
  { id: 'commandPalette', description: '命令面板',     combo: { key: 'p', ctrl: true, shift: true } },
  { id: 'focusMode',      description: '专注模式',     combo: { key: 'F8' } },
  { id: 'typewriterMode', description: '打字机模式',   combo: { key: 'F9' } },
  { id: 'bold',           description: '粗体',         combo: { key: 'b', ctrl: true, shift: true } },
  { id: 'italic',         description: '斜体',         combo: { key: 'i', ctrl: true, shift: true } },
  { id: 'find',           description: '查找',         combo: { key: 'f', ctrl: true } },
  { id: 'outline',        description: '大纲视图',     combo: { key: 'o', ctrl: true, shift: true } }
]

export function comboEquals(a: Combo, b: Combo): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase()
    && !!a.ctrl === !!b.ctrl
    && !!a.shift === !!b.shift
    && !!a.alt === !!b.alt
    && !!a.meta === !!b.meta
}

export function findConflict(
  defs: ShortcutDef[],
  overrides: Record<string, Combo>,
  excludeId: string,
  combo: Combo
): ShortcutDef | null {
  for (const d of defs) {
    if (d.id === excludeId) continue
    const effective = overrides[d.id] ?? d.combo
    if (comboEquals(effective, combo)) return d
  }
  return null
}

export function formatCombo(combo: Combo): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  if (combo.meta) parts.push('Cmd')
  parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  return parts.join('+')
}

export function normalizeFromEvent(e: KeyboardEvent): Combo | null {
  if (e.key === 'Escape') return null
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return { key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }
}

export function isValidCombo(combo: Combo): boolean {
  if (combo.ctrl || combo.alt || combo.meta) return true
  return /^F([1-9]|1[0-2])$/.test(combo.key)
}
```

- [ ] **Step 2: 类型检查** — `npx tsc --noEmit 2>&1 | grep "shortcutService"` → 无输出。
- [ ] **Step 3: 构建** — `npm run build` → 通过。
- [ ] **Step 4: 提交**
```bash
git add src/renderer/services/shortcutService.ts
git commit -m "$(cat <<'EOF'
feat(shortcuts): 新增 shortcutService（Combo/DEFAULT_SHORTCUTS/纯函数）

默认 14 项带 id；comboEquals/findConflict/formatCombo/normalizeFromEvent
/isValidCombo 纯函数。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: useShortcutStore

**Files:** Modify `src/renderer/stores/index.ts`（文件末尾追加）

- [ ] **Step 1: 追加 store**

文件顶部 import 行已有 `import { persist, createJSONStorage } from 'zustand/middleware'` 与 `import type { Chapter, ProjectData, RecentProject } from '../common/ipc'`。新增 import：
```ts
import type { Combo } from '../services/shortcutService'
```
> 注：`stores/index.ts` 在 `src/renderer/stores/`，`../services/shortcutService` → `src/renderer/services/shortcutService.ts`，正确解析。

文件末尾追加：
```ts
// 快捷键自定义（应用级，跨项目共享）
interface ShortcutState {
  overrides: Record<string, Combo>
  dialogOpen: boolean
  setBinding: (id: string, combo: Combo) => void
  resetBinding: (id: string) => void
  resetAll: () => void
  setDialogOpen: (open: boolean) => void
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      overrides: {},
      dialogOpen: false,
      setBinding: (id, combo) => set((s) => ({ overrides: { ...s.overrides, [id]: combo } })),
      resetBinding: (id) => set((s) => {
        const overrides = { ...s.overrides }
        delete overrides[id]
        return { overrides }
      }),
      resetAll: () => set({ overrides: {} }),
      setDialogOpen: (open) => set({ dialogOpen: open })
    }),
    {
      name: 'shortcut-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ overrides: s.overrides })
    }
  )
)
```

- [ ] **Step 2: 类型检查** — `npx tsc --noEmit 2>&1 | grep "stores/index"` → 仅既有 TS2307（`../common/ipc`），无新增。
- [ ] **Step 3: 构建** — `npm run build` → 通过。
- [ ] **Step 4: 提交**
```bash
git add src/renderer/stores/index.ts
git commit -m "$(cat <<'EOF'
feat(shortcuts): 新增 useShortcutStore（overrides + dialogOpen，应用级 persist）

localStorage 持久化 overrides（不持久化 dialogOpen）；setBinding/resetBinding
/resetAll/setDialogOpen。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: useKeyboard 重构

**Files:** Modify `src/renderer/hooks/useKeyboard.ts`（整文件重写）

- [ ] **Step 1: 整文件替换**

```ts
import { useEffect, useCallback, useRef } from 'react'
import {
  DEFAULT_SHORTCUTS, comboEquals, normalizeFromEvent
} from '../services/shortcutService'
import type { Combo } from '../services/shortcutService'
import { useShortcutStore } from '../stores'

interface UseKeyboardOptions {
  enabled?: boolean
  onSave?: () => void
  onSaveAll?: () => void
  onNew?: () => void
  onOpen?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onToggleSidebar?: () => void
  onToggleCommandPalette?: () => void
  onToggleFocusMode?: () => void
  onToggleTypewriterMode?: () => void
  onBold?: () => void
  onItalic?: () => void
  onFind?: () => void
  onOutline?: () => void
}

export function useKeyboard(options: UseKeyboardOptions = {}) {
  const {
    enabled = true,
    onSave, onSaveAll, onNew, onOpen, onUndo, onRedo,
    onToggleSidebar, onToggleCommandPalette, onToggleFocusMode,
    onToggleTypewriterMode, onBold, onItalic, onFind, onOutline
  } = options

  const overrides = useShortcutStore((s) => s.overrides)

  const actionMap: Record<string, (() => void) | undefined> = {
    save: onSave, saveAll: onSaveAll, new: onNew, open: onOpen,
    undo: onUndo, redo: onRedo, toggleSidebar: onToggleSidebar,
    commandPalette: onToggleCommandPalette, focusMode: onToggleFocusMode,
    typewriterMode: onToggleTypewriterMode, bold: onBold, italic: onItalic,
    find: onFind, outline: onOutline
  }

  interface Binding { id: string; combo: Combo; description: string; action: () => void }
  const bindingsRef = useRef<Binding[]>([])

  useEffect(() => {
    bindingsRef.current = DEFAULT_SHORTCUTS.map((d) => ({
      id: d.id,
      combo: overrides[d.id] ?? d.combo,
      description: d.description,
      action: () => actionMap[d.id]?.()
    }))
  }, [
    overrides, onSave, onSaveAll, onNew, onOpen, onUndo, onRedo,
    onToggleSidebar, onToggleCommandPalette, onToggleFocusMode,
    onToggleTypewriterMode, onBold, onItalic, onFind, onOutline
  ])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return
    const target = event.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // 输入框内仅放行命令面板(Ctrl+P)与保存(Ctrl+S)
      const k = event.key.toLowerCase()
      if (k !== 'p' && k !== 's') return
    }
    const combo = normalizeFromEvent(event)
    if (!combo) return
    for (const b of bindingsRef.current) {
      if (comboEquals(b.combo, combo)) {
        event.preventDefault()
        event.stopPropagation()
        b.action()
        return
      }
    }
  }, [enabled])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return {
    shortcuts: bindingsRef.current.map((b) => ({
      id: b.id, ...b.combo, description: b.description
    }))
  }
}

export default useKeyboard
```

> 既有 `KeyboardShortcut` 接口与硬编码 `DEFAULT_SHORTCUTS` 删除（被 shortcutService 取代）。返回项多了 `id`（无消费方依赖旧形状）。

- [ ] **Step 2: 类型检查** — `npx tsc --noEmit 2>&1 | grep "useKeyboard"` → 无输出。
- [ ] **Step 3: 构建** — `npm run build` → 通过。
- [ ] **Step 4: 提交**
```bash
git add src/renderer/hooks/useKeyboard.ts
git commit -m "$(cat <<'EOF'
refactor(shortcuts): useKeyboard 改为合并默认+用户覆盖

从 useShortcutStore 订阅 overrides；id→action 映射；匹配用
normalizeFromEvent+comboEquals；覆盖变化即时生效。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ShortcutDialog.tsx（新建）

**Files:** Create `src/renderer/components/Dialogs/ShortcutDialog.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import React, { useState, useEffect } from 'react'
import { Modal, Button, Space, Typography, Tag } from 'antd'
import {
  DEFAULT_SHORTCUTS, formatCombo, normalizeFromEvent, isValidCombo, findConflict
} from '../../services/shortcutService'
import { useShortcutStore } from '../../stores'

const { Text } = Typography

function ShortcutDialog() {
  const overrides = useShortcutStore((s) => s.overrides)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const dialogOpen = useShortcutStore((s) => s.dialogOpen)
  const setDialogOpen = useShortcutStore((s) => s.setDialogOpen)

  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!capturingId) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const combo = normalizeFromEvent(e)
      if (!combo) { setCapturingId(null); setHint(''); return } // Esc/纯修饰 → 取消
      if (!isValidCombo(combo)) {
        setHint('需要修饰键(Ctrl/Alt/Cmd)或功能键(F1-F12)')
        return
      }
      const conflict = findConflict(DEFAULT_SHORTCUTS, overrides, capturingId, combo)
      if (conflict) {
        setHint(`与「${conflict.description}」冲突`)
        return
      }
      setBinding(capturingId, combo)
      setCapturingId(null)
      setHint('')
    }
    window.addEventListener('keydown', handler, true) // 捕获阶段吞键
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturingId, overrides, setBinding])

  const close = () => {
    setCapturingId(null)
    setHint('')
    setDialogOpen(false)
  }

  return (
    <Modal
      title="快捷键设置"
      open={dialogOpen}
      onCancel={close}
      width={520}
      footer={<Button onClick={resetAll} disabled={!!capturingId}>全部重置为默认</Button>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {DEFAULT_SHORTCUTS.map((d) => {
          const effective = overrides[d.id] ?? d.combo
          const overridden = !!overrides[d.id]
          const capturing = capturingId === d.id
          return (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 0', borderBottom: '1px solid #333'
              }}
            >
              <Text style={{ color: '#d4d4d4' }}>{d.description}</Text>
              <Space size="small">
                {capturing ? (
                  <Text style={{ color: hint.includes('冲突') || hint.includes('需要') ? '#f5222d' : '#1890ff', fontSize: 12 }}>
                    {hint || '按下新组合…(Esc 取消)'}
                  </Text>
                ) : (
                  <Tag style={{ borderColor: overridden ? '#faad14' : '#333', color: overridden ? '#faad14' : '#d4d4d4' }}>
                    {formatCombo(effective)}
                  </Tag>
                )}
                <Button
                  size="small"
                  onClick={() => {
                    if (capturing) {
                      setCapturingId(null)
                      setHint('')
                    } else {
                      setCapturingId(d.id)
                      setHint('')
                    }
                  }}
                  disabled={!!capturingId && !capturing}
                >
                  {capturing ? '取消' : '重新绑定'}
                </Button>
                {overridden && (
                  <Button size="small" onClick={() => resetBinding(d.id)} disabled={!!capturingId}>
                    重置
                  </Button>
                )}
              </Space>
            </div>
          )
        })}
        <Text style={{ color: '#666', fontSize: 11 }}>
          已自定义的快捷键以橙色标记。冲突或无效组合将被阻止。
        </Text>
      </Space>
    </Modal>
  )
}

export default ShortcutDialog
```

- [ ] **Step 2: 类型检查** — `npx tsc --noEmit 2>&1 | grep "ShortcutDialog"` → 无输出。
- [ ] **Step 3: 构建** — `npm run build` → 通过。
- [ ] **Step 4: 提交**
```bash
git add src/renderer/components/Dialogs/ShortcutDialog.tsx
git commit -m "$(cat <<'EOF'
feat(shortcuts): 新增 ShortcutDialog（列表+按键捕获 rebind+冲突阻断+重置）

每行显示当前组合；重新绑定进入捕获态，keydown 归一化+有效性+冲突检测；
单项/全部重置。dialogOpen 由 store 持有。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 接线入口（App / Workspace / Settings）

**Files:** Modify `src/renderer/App.tsx`、`src/renderer/pages/Workspace/index.tsx`、`src/renderer/pages/Settings/index.tsx`

- [ ] **Step 1: App.tsx 渲染 ShortcutDialog**

读 `src/renderer/App.tsx`。当前 `AppRouter` 返回 `<BrowserRouter>...</BrowserRouter>`。改为片段包裹并追加全局对话框：
```tsx
import ShortcutDialog from './components/Dialogs/ShortcutDialog'
...
function AppRouter() {
  return (
    <>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
      <ShortcutDialog />
    </>
  )
}
```
（其余 import 保持：Home/Workspace/Settings。）

- [ ] **Step 2: Workspace useMenu 加 'shortcuts'**

读 `src/renderer/pages/Workspace/index.tsx`。在 import 区已有 `import { useEditorStore } from '../../stores'`；新增：
```tsx
import { useShortcutStore } from '../../stores'
```
组件内（其他 store hook 附近）加：
```tsx
  const setShortcutDialogOpen = useShortcutStore((s) => s.setDialogOpen)
```
在 `useMenu((event, ...args) => { switch... })` 的 `default:` 之前加：
```tsx
      case 'shortcuts':
        setShortcutDialogOpen(true)
        break
```

- [ ] **Step 3: Settings 页加「快捷键」分区**

读 `src/renderer/pages/Settings/index.tsx`。在主体（`<ThemeSettings />` 之上或之下）加一个分区：标题「快捷键」+ 说明 + 按钮「自定义快捷键」→ 打开对话框。具体：在渲染 `<ThemeSettings />` 的容器内，其前或后插入：
```tsx
          <div style={{ padding: '0 16px', marginTop: 16, borderTop: '1px solid #333', paddingTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>快捷键</Text>
              <Text style={{ color: '#888', fontSize: 12 }}>自定义或查看命令的键盘快捷键。</Text>
              <Button
                onClick={() => useShortcutStore.getState().setDialogOpen(true)}
                style={{ width: 'fit-content' }}
              >
                自定义快捷键
              </Button>
            </Space>
          </div>
```
> 用 `useShortcutStore.getState().setDialogOpen(true)`（非 hook 调用），无需在 Settings 组件顶部加 selector，避免额外订阅。需 `import { useShortcutStore } from '../../stores'` 与确认 `Button`、`Space`、`Text` 已在该文件 import（Settings 页 batch1 用了 Button/Typography；按需补 import）。

- [ ] **Step 4: 类型检查** — `npx tsc --noEmit 2>&1 | grep -E "App.tsx|pages/Workspace|pages/Settings"` → 仅既有 TS6133（Workspace 的 React/Title/loading/handleDeleteChapter），无新增。
- [ ] **Step 5: 构建** — `npm run build` → 通过。
- [ ] **Step 6: 手动冒烟（核心）**
  Run: `npm run dev`，进入工作区/设置：
  1. 菜单「帮助→快捷键参考」或 Settings「自定义快捷键」→ 弹出对话框，列表显示当前组合。
  2. rebind「保存」为 Ctrl+Q → 关闭 → Ctrl+Q 触发保存；原 Ctrl+S 不再触发保存。
  3. 冲突：把「保存」改为 Ctrl+N（新建占用）→ 提示「与「新建」冲突」，不生效。
  4. 无效：改为纯「K」→ 提示需要修饰键/功能键。
  5. 重置单项 → 回默认；全部重置 → 全回默认。
  6. 关闭重开应用 → 自定义仍在（持久化）。
  7. 回归：Ctrl+B 切栏、F8 专注、Ctrl+Shift+P 命令面板、统计、导出不受影响。
- [ ] **Step 7: 提交**
```bash
git add src/renderer/App.tsx src/renderer/pages/Workspace/index.tsx src/renderer/pages/Settings/index.tsx
git commit -m "$(cat <<'EOF'
feat(shortcuts): 接线 ShortcutDialog 入口（App 全局渲染 + 菜单 + 设置按钮）

App 渲染 ShortcutDialog 一次；Workspace useMenu 'shortcuts' 打开；
Settings 加「快捷键」分区按钮。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 文档状态更新（阶段15）

**Files:** Modify `docs/AUDIT.md`、`README.md`、`docs/DEVELOPMENT.md`

- [ ] **Step 1: AUDIT.md 追加批次4 复审段**

在「## 2026-08-02 复审：批次 3 写作统计」段之后插入：
```markdown
## 2026-08-02 复审：批次 4 快捷键自定义

分支 `feat/shortcut-customization`，详见 `docs/superpowers/plans/2026-08-02-shortcut-customization.md`。已修复：

- **快捷键自定义 + 冲突检测（阶段15）**：`useKeyboard` 原硬编码默认 → 新增 `shortcutService`（14 项带 id + comboEquals/findConflict/formatCombo/normalizeFromEvent/isValidCombo 纯函数）+ `useShortcutStore`（应用级 localStorage 持久化 overrides）；useKeyboard 合并默认+用户覆盖、id→action、覆盖即时生效。新建 `ShortcutDialog`（列表 + 按键捕获 rebind + 冲突阻断 + 单项/全部重置），App 全局渲染；菜单「快捷键参考」与 Settings 按钮入口。

至此阶段 15/16 与 17(Markdown) 完成；仍待做：导出 Word/PDF/ePub（阶段17 剩余）。4 批审计整改收口。
```

- [ ] **Step 2: README.md 更新阶段15 行 + 真实进度**
  - 阶段15 行 → `✅ 已实现（自定义绑定 + 冲突检测，应用级持久化）`。
  - 「真实进度」链路追加「+ 快捷键自定义」；仍待做仅留「17 剩余 Word·PDF·ePub 导出」。

- [ ] **Step 3: DEVELOPMENT.md 阶段15 行 → `✅ 已实现`**（其余行不动）。

- [ ] **Step 4: 提交**
```bash
git add docs/AUDIT.md README.md docs/DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
docs: 更新进度（批次4 快捷键自定义完成；4 批整改收口）

阶段15 标完成；AUDIT 追加批次4 复审段；真实进度仅余 Word/PDF/ePub 导出。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 收尾验证（全部 Task 完成后）

- `npx tsc --noEmit`：总错误数 ≤ 54，被改文件无新错误。
- `npm run build`：通过。
- 完整手动冒烟（合并各 Task 冒烟步骤）。
- `git log --oneline feat/shortcut-customization ^main`：确认提交（spec + 6 task）。

## 后续

本批为 4 批路线图最后一批。合并 `feat/shortcut-customization` 到 main 后，审计整改（阶段 5/7/8/10/11/12/13/14/15/16/17-Markdown）全部完成。剩余可选：导出 Word/PDF/ePub、DEVELOPMENT 表历史漂移同步、修 `npm run lint`。

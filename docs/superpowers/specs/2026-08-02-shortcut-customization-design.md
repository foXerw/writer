# 批次 4 设计：快捷键自定义（Shortcut Customization）

> 日期: 2026-08-02
> 范围: 快捷键用户自定义绑定 + 冲突检测（审计阶段15 两项缺失目标）
> 依据: `docs/AUDIT.md`（阶段15）+ 2026-08-02 代码复核
> 关联: 4 批路线图最后一批（批次1-3 已合并推送 main）

---

## 背景与现状（已复核）

- `src/renderer/hooks/useKeyboard.ts`：`DEFAULT_SHORTCOUTS` **硬编码、无 command id**（仅 description）；`useKeyboard(options)` 把 options 回调内联拼成 `shortcutsRef`；keydown 用 `ctrl===ctrlKey||metaKey` 等匹配；返回 `shortcuts` 供显示。**无持久化、无 store**。
- `CommandPalette.tsx` 有自己的命令列表（`file:save` 等 key），与 useKeyboard 快捷键是两套（命名重叠）——本批**不动**它。
- 菜单 `'shortcuts'` 事件（帮助→快捷键参考）**未处理**（命中 default）。
- 审计要求：① 用户自定义绑定 ② 冲突检测 —— 均缺失。

## 目标

- 给快捷键补稳定 command id；新增持久化 `useShortcutStore`（应用级 localStorage）。
- `useKeyboard` 合并默认 + 用户覆盖，覆盖变化即时生效。
- 冲突检测纯函数：rebind 时查重，阻断重复组合。
- 专门对话框：列表 + 按键捕获 rebind + 冲突提示 + 单项/全部重置。
- 入口：菜单「快捷键参考」(复用 `'shortcuts'` 事件) + `/settings` 页按钮。

**无新依赖，无主进程改动。**

---

## 数据模型

```ts
export interface Combo {
  key: string         // 字母小写（'s'）或符号键名（'F8'、'Escape'、'ArrowUp'）
  ctrl?: boolean      // 捕获时 ctrl||meta 归一为 ctrl（跨平台）
  shift?: boolean
  alt?: boolean
  meta?: boolean      // 类型保留；默认/捕获不单独使用
}
export interface ShortcutDef { id: string; combo: Combo; description: string }
```

`useShortcutStore`（Zustand + persist，`shortcut-storage`，**应用级**）：
```ts
interface ShortcutState {
  overrides: Record<string, Combo>   // id -> 用户覆盖
  dialogOpen: boolean
  setBinding: (id: string, combo: Combo) => void
  resetBinding: (id: string) => void
  resetAll: () => void
  setDialogOpen: (open: boolean) => void
}
// partialize 仅持久化 overrides（不持久化 dialogOpen）
```

## 默认绑定（`DEFAULT_SHORTCOUTS`，补 id）

| id | description | combo |
|----|-------------|-------|
| save | 保存 | Ctrl+S |
| saveAll | 保存全部 | Ctrl+Shift+S |
| new | 新建 | Ctrl+N |
| open | 打开 | Ctrl+O |
| undo | 撤销 | Ctrl+Z |
| redo | 重做 | Ctrl+Y |
| toggleSidebar | 切换侧边栏 | Ctrl+B |
| commandPalette | 命令面板 | Ctrl+Shift+P |
| focusMode | 专注模式 | F8 |
| typewriterMode | 打字机模式 | F9 |
| bold | 粗体 | Ctrl+Shift+B |
| italic | 斜体 | Ctrl+Shift+I |
| find | 查找 | Ctrl+F |
| outline | 大纲视图 | Ctrl+Shift+O |

默认之间无冲突（toggleSidebar=Ctrl+B ≠ bold=Ctrl+Shift+B；open=Ctrl+O ≠ outline=Ctrl+Shift+O；save=Ctrl+S ≠ saveAll=Ctrl+Shift+S）。

---

## 架构与文件

| 文件 | 改动 |
|------|------|
| `src/renderer/services/shortcutService.ts` | **新建**：`Combo`/`ShortcutDef`、`DEFAULT_SHORTCOUTS`、`comboEquals`/`findConflict`/`formatCombo`/`normalizeFromEvent`/`isValidCombo` |
| `src/renderer/stores/index.ts` | 新增 `useShortcutStore`（overrides + dialogOpen + actions，persist） |
| `src/renderer/hooks/useKeyboard.ts` | 重构：从 store 读 overrides 合并；id→action 映射；匹配用 `normalizeFromEvent`+`comboEquals` |
| `src/renderer/components/Dialogs/ShortcutDialog.tsx` | **新建**：列表 + 捕获 rebind + 冲突提示 + 重置 |
| `src/renderer/App.tsx` | 渲染 `<ShortcutDialog />` 一次（全局单实例，store 持 dialogOpen） |
| `src/renderer/pages/Workspace/index.tsx` | `useMenu` 加 `case 'shortcuts': setDialogOpen(true)` |
| `src/renderer/pages/Settings/index.tsx` | 加「快捷键」分区 + 按钮 → `setDialogOpen(true)` |

---

## `shortcutService.ts`（纯函数）

```ts
export const DEFAULT_SHORTCOUTS: ShortcutDef[] = [
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

// 查找占用 combo 的其它命令（excludeId 除外）；返回该 def 或 null
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

// 从 keydown 归一化为 Combo（meta→ctrl）；null 表示忽略（纯修饰键 / Escape）
export function normalizeFromEvent(e: KeyboardEvent): Combo | null {
  if (e.key === 'Escape') return null
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return { key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }
}

// 有效：须有 Ctrl/Alt/Meta 修饰键，或为 F1-F12 功能键（避免与打字冲突）
export function isValidCombo(combo: Combo): boolean {
  if (combo.ctrl || combo.alt || combo.meta) return true
  return /^F([1-9]|1[0-2])$/.test(combo.key)
}
```

---

## `useKeyboard.ts` 重构

- 从 `useShortcutStore` 订阅 `overrides`（变化即重新构建绑定）。
- `actionMap: Record<id, () => void>` 由 options 回调填充（`save: onSave` 等）。
- 构建 `bindings = DEFAULT_SHORTCOUTS.map(d => ({ id: d.id, description: d.description, combo: overrides[d.id] ?? d.combo, action: () => actionMap[d.id]?.() }))`，存入 ref（依赖 overrides + 各回调）。
- keydown handler：保留既有「输入框内仅放行 Ctrl+P/Ctrl+S」逻辑；然后 `const combo = normalizeFromEvent(event); if (combo) for (b of bindings) if (comboEquals(b.combo, combo)) { preventDefault; stopPropagation; b.action(); return }`。
- 返回 `{ shortcuts: bindings.map(b => ({ id: b.id, ...b.combo, description: b.description })) }` 供显示。

## `ShortcutDialog.tsx`（新建）

- 读 store：`overrides`、`setBinding`/`resetBinding`/`resetAll`、`dialogOpen`/`setDialogOpen`。
- 列表：每行 = description + `formatCombo(effective)` + 「重新绑定」按钮 + （若已覆盖）「重置」按钮。顶部「全部重置」。
- 捕获态：点「重新绑定」置 `capturingId`；渲染「按下新组合…（Esc 取消）」；窗口 keydown 监听（捕获态时 preventDefault）：`combo = normalizeFromEvent(e)`；若 null（Esc/纯修饰）→ 取消捕获；否则 `isValidCombo`？否→提示「需要修饰键或功能键」并保持捕获；`findConflict(DEFAULT, overrides, capturingId, combo)`？非 null→提示「与「{conflict.description}」冲突」并保持捕获；通过→`setBinding(capturingId, combo)`、退出捕获。
- Modal：`open={dialogOpen}` `onCancel={() => setDialogOpen(false)}`。

## 入口

- **App.tsx**：在 `<BrowserRouter>` 外或内渲染 `<ShortcutDialog />`（全局单实例）。
- **Workspace**：`useMenu` handler 加 `case 'shortcuts': setDialogOpen(true); break`（从 store 取 `setDialogOpen`）。
- **Settings 页**：在 ThemeSettings 之上或之下加「快捷键」分区，含说明 + 「自定义快捷键」按钮 → `setDialogOpen(true)`。

---

## 边界与取舍

- **应用级持久化**：overrides 存 localStorage（跨项目共享），与编辑器设置一致；非项目级。
- **meta 归一为 ctrl**：捕获与匹配都把 Cmd 当 Ctrl，跨平台一致；`meta` 字段保留但默认/捕获不单独用。
- **冲突阻断**：不允许分配已被占用的组合；提示占用方；保持捕获态供重试或 Esc 取消。
- **有效性**：纯字母/数字无修饰键的组合被拒（防与打字冲突）；功能键 F1-F12 允许无修饰。
- **Escape**：捕获态 Esc 取消，不绑定 Escape。
- **捕获态吞键**：捕获时 preventDefault，避免触发既有快捷键。
- **不动 CommandPalette**（命令搜索，独立）。
- **不改既有「输入框放行 Ctrl+S/P」行为**。

## 范围外（明确不做）

- 按 id 禁用某快捷键、导入/导出快捷键配置、快捷键分组折叠、跨设备同步。
- 修改 CommandPalette 或菜单加速键（menu.ts 的 accelerator 仍为主进程菜单服务，独立于 renderer 绑定）。
- 给 redo 增加 Ctrl+Shift+Z 替代键（保持单一 Ctrl+Y）。

---

## 测试与验证（无测试框架）

- `npx tsc --noEmit`：被改文件不引入新错误（基线约 54）。
- `npm run build`：通过。
- 手动冒烟（`npm run dev`）：
  1. 菜单「帮助→快捷键参考」或 Settings「自定义快捷键」按钮 → 弹出 ShortcutDialog，列表显示当前组合。
  2. rebind：如把「保存」改为 Ctrl+Q → 关闭对话框 → Ctrl+Q 触发保存（原 Ctrl+S 失效）。
  3. 冲突：把「保存」改为 Ctrl+N（被「新建」占用）→ 提示冲突、不生效、保持捕获。
  4. 无效：把某项改为纯「K」（无修饰）→ 提示需要修饰键/功能键。
  5. 重置单项 → 回默认；全部重置 → 全回默认。
  6. 重启应用（重开）→ 自定义仍在（持久化）。
  7. 回归：批次1-3 的 Ctrl+B 切栏、F8 专注、Ctrl+S 保存、统计、导出等不受影响。

## 涉及文件清单

新建 2（`shortcutService.ts`、`ShortcutDialog.tsx`），修改 5（stores、useKeyboard、App、Workspace、Settings）。预计净增约 200–260 行。

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

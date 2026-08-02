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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actionMap 由下方各回调派生，已逐一列入依赖
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
}

export default useKeyboard

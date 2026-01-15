import { useEffect, useCallback, useRef } from 'react'

interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  action: () => void
  description?: string
}

// 快捷键配置
const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // 文件操作
  { key: 's', ctrl: true, action: () => {}, description: '保存' },
  { key: 'S', ctrl: true, shift: true, action: () => {}, description: '保存全部' },
  { key: 'n', ctrl: true, action: () => {}, description: '新建' },
  { key: 'o', ctrl: true, action: () => {}, description: '打开' },

  // 编辑操作
  { key: 'z', ctrl: true, action: () => {}, description: '撤销' },
  { key: 'y', ctrl: true, action: () => {}, description: '重做' },
  { key: 'z', ctrl: true, shift: true, action: () => {}, description: '重做(替代)' },
  { key: 'a', ctrl: true, action: () => {}, description: '全选' },
  { key: 'f', ctrl: true, action: () => {}, description: '查找' },

  // 格式
  { key: 'b', ctrl: true, shift: true, action: () => {}, description: '粗体' },
  { key: 'i', ctrl: true, shift: true, action: () => {}, description: '斜体' },

  // 视图
  { key: 'b', ctrl: true, action: () => {}, description: '切换侧边栏' },
  { key: 'p', ctrl: true, shift: true, action: () => {}, description: '命令面板' },
  { key: 'F8', action: () => {}, description: '专注模式' },
  { key: 'F9', action: () => {}, description: '打字机模式' },

  // 导航
  { key: 'o', ctrl: true, shift: true, action: () => {}, description: '大纲视图' },
]

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
    onSave,
    onSaveAll,
    onNew,
    onOpen,
    onUndo,
    onRedo,
    onToggleSidebar,
    onToggleCommandPalette,
    onToggleFocusMode,
    onToggleTypewriterMode,
    onBold,
    onItalic,
    onFind,
    onOutline
  } = options

  const shortcutsRef = useRef<KeyboardShortcut[]>(DEFAULT_SHORTCUTS)

  // 更新快捷键回调
  useEffect(() => {
    shortcutsRef.current = [
      { key: 's', ctrl: true, action: () => onSave?.(), description: '保存' },
      { key: 'S', ctrl: true, shift: true, action: () => onSaveAll?.(), description: '保存全部' },
      { key: 'n', ctrl: true, action: () => onNew?.(), description: '新建' },
      { key: 'o', ctrl: true, action: () => onOpen?.(), description: '打开' },
      { key: 'z', ctrl: true, action: () => onUndo?.(), description: '撤销' },
      { key: 'y', ctrl: true, action: () => onRedo?.(), description: '重做' },
      { key: 'b', ctrl: true, action: () => onToggleSidebar?.(), description: '切换侧边栏' },
      { key: 'p', ctrl: true, shift: true, action: () => onToggleCommandPalette?.(), description: '命令面板' },
      { key: 'F8', action: () => onToggleFocusMode?.(), description: '专注模式' },
      { key: 'F9', action: () => onToggleTypewriterMode?.(), description: '打字机模式' },
      { key: 'b', ctrl: true, shift: true, action: () => onBold?.(), description: '粗体' },
      { key: 'i', ctrl: true, shift: true, action: () => onItalic?.(), description: '斜体' },
      { key: 'f', ctrl: true, action: () => onFind?.(), description: '查找' },
      { key: 'o', ctrl: true, shift: true, action: () => onOutline?.(), description: '大纲视图' },
    ]
  }, [
    onSave, onSaveAll, onNew, onOpen,
    onUndo, onRedo, onToggleSidebar,
    onToggleCommandPalette, onToggleFocusMode,
    onToggleTypewriterMode, onBold, onItalic, onFind, onOutline
  ])

  // 处理键盘事件
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return

    // 忽略在输入框中的快捷键
    const target = event.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // 但允许 Ctrl+P (命令面板) 和 Ctrl+S (保存)
      if (event.key.toLowerCase() !== 'p' && event.key.toLowerCase() !== 's') {
        return
      }
    }

    for (const shortcut of shortcutsRef.current) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
      const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey)
      const shiftMatch = !!shortcut.shift === event.shiftKey
      const altMatch = !!shortcut.alt === event.altKey

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        event.preventDefault()
        event.stopPropagation()
        shortcut.action()
        return
      }
    }
  }, [enabled])

  // 注册和清理
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  // 返回快捷键列表（用于显示）
  return {
    shortcuts: shortcutsRef.current.map(s => ({
      key: s.key,
      ctrl: s.ctrl,
      shift: s.shift,
      alt: s.alt,
      meta: s.meta,
      description: s.description
    }))
  }
}

export default useKeyboard

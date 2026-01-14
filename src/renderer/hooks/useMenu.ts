import { useEffect, useCallback } from 'react'

// 菜单事件类型
export type MenuEvent =
  | 'newProject'
  | 'newChapter'
  | 'save'
  | 'saveAs'
  | 'find'
  | 'replace'
  | 'toggleOutline'
  | 'toggleChapterTree'
  | 'focusMode'
  | 'typewriterMode'
  | 'prevChapter'
  | 'nextChapter'
  | 'wordCount'
  | 'dailyStats'
  | 'characters'
  | 'settings'
  | 'plot'
  | 'export'
  | 'shortcuts'
  | 'about'

interface MenuEventHandler {
  (event: MenuEvent): void
}

// 菜单Hook
export function useMenu(handler: MenuEventHandler) {
  useEffect(() => {
    const listeners: (() => void)[] = []

    const events: MenuEvent[] = [
      'newProject',
      'newChapter',
      'save',
      'saveAs',
      'find',
      'replace',
      'toggleOutline',
      'toggleChapterTree',
      'focusMode',
      'typewriterMode',
      'prevChapter',
      'nextChapter',
      'wordCount',
      'dailyStats',
      'characters',
      'settings',
      'plot',
      'export',
      'shortcuts',
      'about'
    ]

    events.forEach((event) => {
      const listener = window.novelWriter?.on?.[event as keyof typeof window.novelWriter.on]?.((...args: unknown[]) => {
        handler(event)
      })
      if (listener) {
        listeners.push(listener)
      }
    })

    return () => {
      listeners.forEach((unsub) => {
        if (typeof unsub === 'function') {
          unsub()
        }
      })
    }
  }, [handler])
}

// 便捷Hook - 用于特定菜单事件
export function useMenuEvent(event: MenuEvent, callback: () => void) {
  const handler = useCallback(
    (e: MenuEvent) => {
      if (e === event) {
        callback()
      }
    },
    [event, callback]
  )

  useMenu(handler)
}

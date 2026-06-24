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

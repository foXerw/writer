import type React from 'react'

// Electron 无边框窗口的拖拽区域样式。
// antd/React 的 CSSProperties 类型不包含 -webkit-app-region，
// 这里集中做一次安全转换，避免各处 style 对象出现 TS2353。
export function appRegionStyle(region: 'drag' | 'no-drag'): React.CSSProperties {
  return { WebkitAppRegion: region } as React.CSSProperties
}

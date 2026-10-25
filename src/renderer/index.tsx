import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import AppRouter from './App'
import { useSettingsStore } from './stores'
import { darkTheme, lightTheme, readPersistedTheme } from './styles/theme'
import { useTheme } from './hooks/useIPC'
import './styles/global.css'

// 冷启动：在 React 挂载前同步设置根主题属性，避免闪屏
document.documentElement.dataset.theme = readPersistedTheme()

function Root() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const { setThemeMode } = useTheme()

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    // fire-and-forget：主进程底色同步失败不应影响渲染，吞掉 rejection 保持原有容错
    setThemeMode(themeMode).catch(() => { /* 忽略底色同步失败 */ })
  }, [themeMode, setThemeMode])

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

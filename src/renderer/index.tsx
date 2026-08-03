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

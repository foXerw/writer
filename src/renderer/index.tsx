import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import AppRouter from './App'
import './styles/global.css'

// 深色主题 token
const darkTheme = {
  token: {
    colorPrimary: '#58a6ff',
    colorBgContainer: '#1e1e1e',
    colorBgElevated: '#252526',
    colorBgLayout: '#1e1e1e',
    colorText: '#d4d4d4',
    colorTextSecondary: '#8c8c8c',
    colorTextTertiary: '#6e6e6e',
    colorBorder: '#333333',
    colorBorderSecondary: '#2d2d2d',
    colorIcon: '#8c8c8c',
    colorIconHover: '#d4d4d4',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    borderRadius: 4,
  },
  components: {
    Layout: {
      headerBg: '#1e1e1e',
      siderBg: '#252526',
      bodyBg: '#1e1e1e',
    },
    Card: {
      colorBgContainer: '#252526',
      colorBorderSecondary: '#333333',
    },
    Modal: {
      colorBgElevated: '#252526',
      colorBgContainer: '#1e1e1e',
    },
    Button: {
      colorPrimaryBg: '#58a6ff',
    },
    Input: {
      colorBgContainer: '#2d2d2d',
      colorBorder: '#333333',
    },
    Select: {
      colorBgContainer: '#2d2d2d',
      colorBorder: '#333333',
    },
    List: {
      colorBgContainer: '#2d2d2d',
    },
    Tabs: {
      colorBgContainer: '#252526',
      colorActiveBar: '#58a6ff',
    },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={darkTheme}>
      <AntdApp>
        <AppRouter />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
)

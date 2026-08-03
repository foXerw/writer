import type { ThemeConfig } from 'antd'

export type ThemeMode = 'dark' | 'light'

// 深色主题 token（现状，原样搬迁自 index.tsx，不改动观感）
export const darkTheme: ThemeConfig = {
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
    Layout: { headerBg: '#1e1e1e', siderBg: '#252526', bodyBg: '#1e1e1e' },
    Card: { colorBgContainer: '#252526', colorBorderSecondary: '#333333' },
    Modal: { colorBgElevated: '#252526', colorBgContainer: '#1e1e1e' },
    Button: { colorPrimaryBg: '#58a6ff' },
    Input: { colorBgContainer: '#2d2d2d', colorBorder: '#333333' },
    Select: { colorBgContainer: '#2d2d2d', colorBorder: '#333333' },
    List: { colorBgContainer: '#2d2d2d' },
    Tabs: { colorBgContainer: '#252526', colorActiveBar: '#58a6ff' },
  },
}

// 浅色主题 token（新增）
export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f5f5',
    colorText: '#141414',
    colorTextSecondary: '#595959',
    colorTextTertiary: '#8c8c8c',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
    colorIcon: '#595959',
    colorIconHover: '#141414',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    borderRadius: 4,
  },
  components: {
    Layout: { headerBg: '#ffffff', siderBg: '#ffffff', bodyBg: '#f5f5f5' },
    Card: { colorBgContainer: '#ffffff', colorBorderSecondary: '#f0f0f0' },
    Modal: { colorBgElevated: '#ffffff', colorBgContainer: '#ffffff' },
    Button: { colorPrimaryBg: '#1677ff' },
    Input: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9' },
    Select: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9' },
    List: { colorBgContainer: '#ffffff' },
    Tabs: { colorBgContainer: '#ffffff', colorActiveBar: '#1677ff' },
  },
}

// 在 React 挂载前同步读取持久化主题，避免冷启动闪屏
export function readPersistedTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem('settings-storage')
    const mode = raw ? JSON.parse(raw)?.state?.themeMode : null
    return mode === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

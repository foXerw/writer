import type { ThemeConfig } from 'antd'

export type ThemeMode = 'dark' | 'light'

// 深色主题 token（组件级覆盖对应 global.css 里迁出的原 !important 规则，色值保持观感一致）
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
    // Modal：原靠 CSS 承担的深色面板色改用组件 token 表达（与 antd 默认推导等值，观感不变）
    Modal: {
      colorBgElevated: '#252526',
      colorBgContainer: '#1e1e1e',
      contentBg: '#252526',
      headerBg: '#252526',
      footerBg: 'transparent',
      titleColor: '#d4d4d4',
    },
    // Button：替代原 [data-theme='dark'] .ant-btn-primary 的 !important 块
    // （#0d419d 实底、hover/active 不变色、无投影；#1f6feb 边框见 global.css 说明）
    Button: {
      colorPrimary: '#0d419d',
      colorPrimaryHover: '#0d419d',
      colorPrimaryActive: '#0d419d',
      primaryShadow: 'none',
      dangerShadow: 'none',
    },
    // placeholder：替代原 .ant-input::placeholder !important 规则
    Input: { colorBgContainer: '#2d2d2d', colorBorder: '#333333', colorTextPlaceholder: '#6e6e6e' },
    Select: { colorBgContainer: '#2d2d2d', colorBorder: '#333333' },
    List: { colorBgContainer: '#2d2d2d' },
    Tabs: {
      colorBgContainer: '#252526',
      itemSelectedColor: '#58a6ff',
      inkBarColor: '#58a6ff',
      cardBg: '#252526',
    },
    // Tree：替代原 .chapter-tree 节点 hover/选中背景的 !important 规则
    Tree: { nodeSelectedBg: '#37373d', nodeHoverBg: '#2d2d2d' },
  },
}

// 浅色主题 token
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
    Modal: {
      colorBgElevated: '#ffffff',
      colorBgContainer: '#ffffff',
      contentBg: '#ffffff',
      headerBg: '#ffffff',
      footerBg: 'transparent',
      titleColor: '#141414',
    },
    Button: { colorPrimaryBg: '#1677ff' },
    Input: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9', colorTextPlaceholder: '#8c8c8c' },
    Select: { colorBgContainer: '#ffffff', colorBorder: '#d9d9d9' },
    List: { colorBgContainer: '#ffffff' },
    Tabs: {
      colorBgContainer: '#ffffff',
      itemSelectedColor: '#1677ff',
      inkBarColor: '#1677ff',
      cardBg: '#ffffff',
    },
    Tree: { nodeSelectedBg: '#e6f4ff', nodeHoverBg: '#f5f5f5' },
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

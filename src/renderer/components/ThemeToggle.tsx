import React from 'react'
import { Button, Tooltip } from 'antd'
import { SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../stores'

interface ThemeToggleProps {
  size?: 'small' | 'middle' | 'large'
}

function ThemeToggle({ size = 'small' }: ThemeToggleProps) {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const isDark = themeMode === 'dark'

  return (
    <Tooltip title={isDark ? '切换到浅色' : '切换到深色'}>
      <Button
        type="text"
        size={size}
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggleTheme}
        style={{ color: 'var(--color-text)', WebkitAppRegion: 'no-drag' }}
      />
    </Tooltip>
  )
}

export default ThemeToggle

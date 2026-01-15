import React from 'react'
import { Space, Button, Typography, Divider } from 'antd'
import {
  BgColorsOutlined,
  FontSizeOutlined,
  LayoutOutlined,
  HighlightOutlined
} from '@ant-design/icons'
import { useEditorStore } from '@/stores'

const { Text } = Typography

interface ThemeSettingsProps {
  onThemeChange?: (theme: 'dark' | 'light') => void
}

const ThemeSettings: React.FC<ThemeSettingsProps> = ({ onThemeChange }) => {
  const {
    fontSize,
    setFontSize,
    showLineNumbers,
    setShowLineNumbers,
    wordWrap,
    setWordWrap
  } = useEditorStore()

  // 预设字体大小
  const fontSizeOptions = [14, 16, 18, 20, 24]

  return (
    <div className="theme-settings" style={{ padding: '16px' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 主题选择 */}
        <div>
          <Space>
            <BgColorsOutlined style={{ color: '#888' }} />
            <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>主题</Text>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Space>
              <Button
                type="primary"
                style={{ background: '#1e1e1e', borderColor: '#333' }}
              >
                深色
              </Button>
              <Button disabled>浅色 (开发中)</Button>
            </Space>
          </div>
        </div>

        <Divider style={{ borderColor: '#333' }} />

        {/* 字体大小 */}
        <div>
          <Space>
            <FontSizeOutlined style={{ color: '#888' }} />
            <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>字体大小</Text>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Space wrap>
              {fontSizeOptions.map(size => (
                <Button
                  key={size}
                  type={fontSize === size ? 'primary' : 'default'}
                  onClick={() => setFontSize(size)}
                  size="small"
                >
                  {size}px
                </Button>
              ))}
            </Space>
          </div>
        </div>

        <Divider style={{ borderColor: '#333' }} />

        {/* 编辑器选项 */}
        <div>
          <Space>
            <LayoutOutlined style={{ color: '#888' }} />
            <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>编辑器选项</Text>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#d4d4d4' }}>显示行号</Text>
                <Button
                  type={showLineNumbers ? 'primary' : 'default'}
                  size="small"
                  onClick={() => setShowLineNumbers(!showLineNumbers)}
                >
                  {showLineNumbers ? '开' : '关'}
                </Button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#d4d4d4' }}>自动换行</Text>
                <Button
                  type={wordWrap ? 'primary' : 'default'}
                  size="small"
                  onClick={() => setWordWrap(!wordWrap)}
                >
                  {wordWrap ? '开' : '关'}
                </Button>
              </div>
            </Space>
          </div>
        </div>

        <Divider style={{ borderColor: '#333' }} />

        {/* 写作增强 */}
        <div>
          <Space>
            <HighlightOutlined style={{ color: '#888' }} />
            <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>写作增强</Text>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#888', fontSize: 12 }}>
                快捷键参考: Ctrl+S保存, Ctrl+B粗体, Ctrl+I斜体, F8专注模式, F9打字机模式, Ctrl+Shift+P命令面板
              </Text>
            </Space>
          </div>
        </div>
      </Space>
    </div>
  )
}

export default ThemeSettings

import { Button, Space, Typography } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ThemeSettings from '../../components/Settings/ThemeSettings'
import { useShortcutStore } from '../../stores'

const { Title, Text } = Typography

function Settings() {
  const navigate = useNavigate()
  const goBack = () => {
    if (window.history.state && (window.history.state as { idx?: number }).idx && (window.history.state as { idx?: number }).idx! > 0) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-base)' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <Button
          type="text"
          icon={<LeftOutlined />}
          onClick={goBack}
          style={{ color: 'var(--color-text)' }}
        />
        <Title level={5} style={{ color: 'var(--color-text)', margin: 0 }}>设置</Title>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ThemeSettings />
        <div style={{ padding: '0 16px', marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>快捷键</Text>
            <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>自定义或查看命令的键盘快捷键。</Text>
            <Button
              onClick={() => useShortcutStore.getState().setDialogOpen(true)}
              style={{ width: 'fit-content' }}
            >
              自定义快捷键
            </Button>
          </Space>
        </div>
      </div>
    </div>
  )
}

export default Settings

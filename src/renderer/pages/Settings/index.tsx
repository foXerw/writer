import { Button, Space, Typography } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AiSettingsSection from '../../components/Settings/AiSettingsSection'
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
    // height=100vh（验收批次 #7-3）：本页曾是 '100%'，但 #root 与页面之间隔着 AntdApp
    // 注入的 .ant-app 包装层——它没有声明高度（CDP 实测 960×600 下 rect=1457px，
    // 由内容撑开），百分比链就此断裂：根容器吃内容全高、内层 flex:1+overflow:auto
    // 的滚动区 clientHeight==scrollHeight（永远不出滚动条），短窗下补全开关等内容
    // 落到视口外且 html/body overflow:hidden 兜死 → 不可达。改 100vh 与 Home/
    // Workspace 两页同款（不动全局 .ant-app，影响面归零）。
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-base)' }}>
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
        {/* AI 服务设置（M4a Task 2）：紧随主题区块，密钥仅掩码展示 */}
        <AiSettingsSection />
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

import { Button, Typography } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ThemeSettings from '../../components/Settings/ThemeSettings'

const { Title } = Typography

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <Button
          type="text"
          icon={<LeftOutlined />}
          onClick={goBack}
          style={{ color: '#d4d4d4' }}
        />
        <Title level={5} style={{ color: '#d4d4d4', margin: 0 }}>设置</Title>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ThemeSettings />
      </div>
    </div>
  )
}

export default Settings

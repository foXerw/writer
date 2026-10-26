import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Layout, Button, Card, Empty, List, Typography, Space } from 'antd'
import { PlusOutlined, FolderOpenOutlined, FileOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { ProjectData } from '@/common/ipc'
import { appRegionStyle } from '../../styles/css'
import { useProjectStore } from '../../stores'
import ProjectDialog from '../../components/Dialogs/ProjectDialog'
import ThemeToggle from '../../components/ThemeToggle'
import { reportMigration } from '../../services/migrationReport'

const { Header, Content } = Layout
const { Title, Text } = Typography

function Home() {
  const navigate = useNavigate()
  // 对话框 open 路径的迁移报告呈现（Task 10-E）：弹窗 open 成功拿到完整 ProjectData（含 migration）
  const { message, modal } = App.useApp()

  // 最近项目唯一真源：zustand persist（localStorage），重启不丢；
  // 写入统一发生在 ProjectDialog 的 create/open 成功回调
  const { recentProjects } = useProjectStore()

  const [createDialogVisible, setCreateDialogVisible] = useState(false)
  const [openDialogVisible, setOpenDialogVisible] = useState(false)

  // 打开最近项目：只带 projectPath（无 project/config）——Workspace 的「路径直达挂载」会据此
  // 补调一次 project:open（A-seam 统一，Task 10）：迁移/watcher/config 全部在该通道内完成，
  // 与对话框 open 收敛到同一条主进程路径。此处不做重复 open。
  const handleOpenProject = (projectPath: string) => {
    navigate('/workspace', { state: { projectPath } })
  }

  // 项目创建成功后跳转
  const handleProjectCreated = (project: ProjectData) => {
    navigate('/workspace', { state: { project: { name: project.name, path: project.path }, config: project.config } })
  }

  // 项目打开成功后跳转
  const handleProjectOpened = (project: ProjectData) => {
    reportMigration(project, { message, modal })
    navigate('/workspace', { state: { project: { name: project.name, path: project.path }, config: project.config } })
  }

  return (
    <Layout style={{ height: '100vh' }}>

      {/* 主内容区 */}
      <Layout>
        <Header style={{
          padding: '0 24px 0 16px',
          background: 'var(--color-bg-base)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          marginRight: 0,
          height: 32,
          ...appRegionStyle('drag')
        }}>
          <Space size="small">
            <FileOutlined style={{ color: 'var(--color-primary)' }} />
            <Title level={4} style={{ margin: 0, color: 'var(--color-text)', fontSize: 14 }}>完美小说</Title>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setCreateDialogVisible(true)}
              style={{
                background: 'var(--color-primary-bg)',
                borderColor: 'var(--color-primary-border)',
                color: '#fff',
                ...appRegionStyle('no-drag')
              }}
            >
              新建项目
            </Button>
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => setOpenDialogVisible(true)}
              style={{
                background: 'var(--color-bg-container)',
                borderColor: 'var(--color-border-secondary)',
                color: 'var(--color-text)',
                ...appRegionStyle('no-drag')
              }}
            >
              打开项目
            </Button>
            <ThemeToggle />
          </Space>
        </Header>

        <Content style={{
          padding: '32px 48px',
          background: 'var(--color-bg-base)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <div style={{ width: '100%', maxWidth: 900 }}>
            {/* 最近项目 */}
            <Card
              title={
                <Space>
                  <ClockCircleOutlined />
                  <span>最近打开</span>
                </Space>
              }
              style={{
                background: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border)',
                marginBottom: 24
              }}
              styles={{ header: { color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' } }}
            >
            {recentProjects.length > 0 ? (
              <List
                dataSource={recentProjects}
                renderItem={(item) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      padding: '12px',
                      borderRadius: '4px',
                      marginBottom: '4px',
                      background: 'var(--color-bg-container)',
                      border: 'none'
                    }}
                    onClick={() => handleOpenProject(item.path)}
                  >
                    <List.Item.Meta
                      avatar={<FolderOpenOutlined style={{ fontSize: '24px', color: 'var(--color-primary)' }} />}
                      title={<Text style={{ color: 'var(--color-text)' }}>{item.name}</Text>}
                      description={<Text style={{ color: 'var(--color-text-secondary)' }}>{item.path}</Text>}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty
                description={<Text style={{ color: 'var(--color-text-secondary)' }}>暂无最近项目</Text>}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button
                  onClick={() => setCreateDialogVisible(true)}
                  style={{
                    background: 'var(--color-primary-bg)',
                    borderColor: 'var(--color-primary-border)',
                    color: '#fff'
                  }}
                >
                  创建第一个项目
                </Button>
              </Empty>
            )}
          </Card>

          {/* 快捷操作 */}
            <Card
              title="开始创作"
              style={{
                background: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border)'
              }}
              styles={{ header: { color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' } }}
            >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => setCreateDialogVisible(true)}
                style={{
                  height: '48px',
                  textAlign: 'left',
                  background: 'var(--color-bg-container)',
                  borderColor: 'var(--color-border-secondary)',
                  color: 'var(--color-text)'
                }}
              >
                新建项目
              </Button>
              <Button
                block
                icon={<FolderOpenOutlined />}
                onClick={() => setOpenDialogVisible(true)}
                style={{
                  height: '48px',
                  textAlign: 'left',
                  background: 'var(--color-bg-container)',
                  borderColor: 'var(--color-border-secondary)',
                  color: 'var(--color-text)'
                }}
              >
                打开项目
              </Button>
            </Space>
          </Card>
          </div>
        </Content>
      </Layout>

      {/* 新建项目对话框 */}
      <ProjectDialog
        open={createDialogVisible}
        mode="create"
        onClose={() => setCreateDialogVisible(false)}
        onProjectCreated={handleProjectCreated}
        onProjectOpened={handleProjectOpened}
      />

      {/* 打开项目对话框 */}
      <ProjectDialog
        open={openDialogVisible}
        mode="open"
        onClose={() => setOpenDialogVisible(false)}
        onProjectCreated={handleProjectCreated}
        onProjectOpened={handleProjectOpened}
      />
    </Layout>
  )
}

export default Home

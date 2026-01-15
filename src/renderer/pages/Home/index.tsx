import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout, Button, Card, Empty, List, Typography, Space } from 'antd'
import { PlusOutlined, FolderOpenOutlined, FileOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { RecentProject } from '../../common/ipc'
import { useProject } from '../../hooks/useIPC'
import ProjectDialog from '../../components/Dialogs/ProjectDialog'

const { Header, Content, Sider } = Layout
const { Title, Text } = Typography

function Home() {
  const navigate = useNavigate()
  const { getRecentProjects } = useProject()

  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [createDialogVisible, setCreateDialogVisible] = useState(false)
  const [openDialogVisible, setOpenDialogVisible] = useState(false)

  // 加载最近项目
  useEffect(() => {
    loadRecentProjects()
  }, [])

  const loadRecentProjects = async () => {
    try {
      const projects = await getRecentProjects()
      setRecentProjects(projects)
    } catch (error) {
      console.error('加载最近项目失败:', error)
    }
  }

  // 打开最近项目
  const handleOpenProject = (projectPath: string) => {
    navigate('/workspace', { state: { projectPath } })
  }

  // 项目创建成功后跳转
  const handleProjectCreated = (projectPath: string) => {
    navigate('/workspace', { state: { projectPath } })
    loadRecentProjects()
  }

  // 项目打开成功后跳转
  const handleProjectOpened = (projectPath: string) => {
    navigate('/workspace', { state: { projectPath } })
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧边栏 */}
      <Sider width={48} theme="dark" style={{ background: '#252526' }}>
      </Sider>

      {/* 主内容区 */}
      <Layout>
        <Header style={{
          padding: '0 24px 0 16px',
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          marginRight: 0,
          height: 40
        }}>
          <Space size="small">
            <FileOutlined style={{ color: '#58a6ff' }} />
            <Title level={4} style={{ margin: 0, color: '#d4d4d4', fontSize: 14 }}>Novel Writer</Title>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setCreateDialogVisible(true)}
              style={{
                background: '#0d419d',
                borderColor: '#1f6feb',
                color: '#fff'
              }}
            >
              新建项目
            </Button>
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => setOpenDialogVisible(true)}
              style={{
                background: '#2d2d2d',
                borderColor: '#444',
                color: '#d4d4d4'
              }}
            >
              打开项目
            </Button>
          </Space>
        </Header>

        <Content style={{
          padding: '24px',
          background: '#1e1e1e',
          overflow: 'auto'
        }}>
          {/* 最近项目 */}
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                <span>最近打开</span>
              </Space>
            }
            style={{
              background: '#252526',
              borderColor: '#333',
              maxWidth: 800
            }}
            styles={{ header: { color: '#d4d4d4', borderBottom: '1px solid #333' } }}
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
                      background: '#2d2d2d',
                      border: 'none'
                    }}
                    onClick={() => handleOpenProject(item.path)}
                  >
                    <List.Item.Meta
                      avatar={<FolderOpenOutlined style={{ fontSize: '24px', color: '#58a6ff' }} />}
                      title={<Text style={{ color: '#d4d4d4' }}>{item.name}</Text>}
                      description={<Text style={{ color: '#888' }}>{item.path}</Text>}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty
                description={<Text style={{ color: '#888' }}>暂无最近项目</Text>}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button
                  onClick={() => setCreateDialogVisible(true)}
                  style={{
                    background: '#0d419d',
                    borderColor: '#1f6feb',
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
              marginTop: '24px',
              background: '#252526',
              borderColor: '#333',
              maxWidth: 800
            }}
            styles={{ header: { color: '#d4d4d4', borderBottom: '1px solid #333' } }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => setCreateDialogVisible(true)}
                style={{
                  height: '48px',
                  textAlign: 'left',
                  background: '#2d2d2d',
                  borderColor: '#444',
                  color: '#d4d4d4'
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
                  background: '#2d2d2d',
                  borderColor: '#444',
                  color: '#d4d4d4'
                }}
              >
                打开项目
              </Button>
            </Space>
          </Card>
        </Content>
      </Layout>

      {/* 新建项目对话框 */}
      <ProjectDialog
        open={createDialogVisible}
        mode="create"
        onClose={() => setCreateDialogVisible(false)}
        onProjectCreated={handleProjectCreated}
      />

      {/* 打开项目对话框 */}
      <ProjectDialog
        open={openDialogVisible}
        mode="open"
        onClose={() => setOpenDialogVisible(false)}
        onProjectOpened={handleProjectOpened}
      />
    </Layout>
  )
}

export default Home

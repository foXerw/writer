import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout, Button, Card, Empty, List, Typography, Space, Modal, Input, message } from 'antd'
import { PlusOutlined, FolderOpenOutlined, FileOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { RecentProject } from '../../common/ipc'
import { useProject, useDialog } from '../../hooks/useIPC'

const { Header, Content, Sider } = Layout
const { Title, Text } = Typography

function Home() {
  const navigate = useNavigate()
  const { getRecentProjects, createProject } = useProject()
  const { openDirectory } = useDialog()

  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectPath, setNewProjectPath] = useState('')
  const [loading, setLoading] = useState(false)

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

  // 选择项目路径
  const handleSelectPath = async () => {
    const path = await openDirectory()
    if (path) {
      setNewProjectPath(path)
    }
  }

  // 创建新项目
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      message.warning('请输入项目名称')
      return
    }
    if (!newProjectPath) {
      message.warning('请选择项目路径')
      return
    }

    setLoading(true)
    try {
      const project = await createProject(newProjectName, newProjectPath, 'novel')
      message.success('项目创建成功')
      setIsModalVisible(false)
      setNewProjectName('')
      setNewProjectPath('')
      navigate('/workspace', { state: { project } })
    } catch (error) {
      message.error('项目创建失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // 打开最近项目
  const handleOpenProject = (projectPath: string) => {
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
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsModalVisible(true)}
            >
              新建项目
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
                description="暂无最近项目"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button type="primary" onClick={() => setIsModalVisible(true)}>
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
                onClick={() => setIsModalVisible(true)}
                style={{ height: '48px', textAlign: 'left' }}
              >
                新建项目
              </Button>
            </Space>
          </Card>
        </Content>
      </Layout>

      {/* 新建项目对话框 */}
      <Modal
        title="新建项目"
        open={isModalVisible}
        onOk={handleCreateProject}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={loading}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong style={{ color: '#d4d4d4' }}>项目名称</Text>
            <Input
              placeholder="输入项目名称"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              style={{ marginTop: '8px' }}
            />
          </div>
          <div>
            <Text strong style={{ color: '#d4d4d4' }}>项目路径</Text>
            <Space style={{ width: '100%', marginTop: '8px' }}>
              <Input
                placeholder="选择项目路径"
                value={newProjectPath}
                readOnly
                style={{ flex: 1 }}
              />
              <Button onClick={handleSelectPath}>浏览</Button>
            </Space>
          </div>
        </Space>
      </Modal>
    </Layout>
  )
}

export default Home

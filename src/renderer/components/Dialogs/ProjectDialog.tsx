import React, { useState, useEffect } from 'react'
import { Modal, Select, Input, Space, Typography, Button, Divider, List, Empty } from 'antd'
import {
  PlusOutlined,
  FolderOpenOutlined,
  FileOutlined,
  BookOutlined,
  FileTextOutlined,
  HighlightOutlined
} from '@ant-design/icons'
import type { ProjectType, RecentProject } from '../../common/ipc'
import { useProject, useDialog } from '../../hooks/useIPC'
import { useProjectStore } from '../../stores'

const { Text } = Typography

interface ProjectDialogProps {
  open: boolean
  mode: 'create' | 'open'
  onClose: () => void
  onProjectCreated?: (projectPath: string) => void
  onProjectOpened?: (projectPath: string) => void
}

interface ProjectTemplate {
  type: ProjectType
  name: string
  icon: React.ReactNode
  description: string
}

const templates: ProjectTemplate[] = [
  {
    type: 'novel',
    icon: <BookOutlined />,
    name: '长篇小说',
    description: '适合长篇故事、章节分明的创作'
  },
  {
    type: 'script',
    icon: <FileTextOutlined />,
    name: '剧本',
    description: '适合剧本、对白为主的创作'
  },
  {
    type: 'essay',
    icon: <HighlightOutlined />,
    name: '散文随笔',
    description: '适合短篇、随笔类创作'
  }
]

function ProjectDialog({
  open,
  mode,
  onClose,
  onProjectCreated,
  onProjectOpened
}: ProjectDialogProps) {
  const { createProject, openProject, getRecentProjects } = useProject()
  const { openDirectory } = useDialog()
  const { recentProjects, addRecentProject } = useProjectStore()

  const [step, setStep] = useState<'templates' | 'config' | 'location'>('templates')
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectType>('novel')
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [recentList, setRecentList] = useState<RecentProject[]>([])

  useEffect(() => {
    if (open && mode === 'open') {
      loadRecentProjects()
    }
  }, [open, mode])

  useEffect(() => {
    if (open && mode === 'create') {
      setStep('templates')
      setProjectName('')
      setProjectPath('')
    }
  }, [open, mode])

  const loadRecentProjects = async () => {
    try {
      const projects = await getRecentProjects()
      setRecentList(projects)
    } catch (error) {
      console.error('加载最近项目失败:', error)
    }
  }

  const handleSelectTemplate = (template: ProjectType) => {
    setSelectedTemplate(template)
  }

  const handleSelectPath = async () => {
    const path = await openDirectory()
    if (path) {
      setProjectPath(path)
    }
  }

  const handleCreate = async () => {
    if (!projectName.trim()) {
      return
    }
    if (!projectPath) {
      return
    }

    setLoading(true)
    try {
      const project = await createProject(projectName, projectPath, selectedTemplate)
      addRecentProject({
        id: project.id,
        name: project.name,
        path: project.path,
        lastOpened: new Date()
      })
      onProjectCreated?.(project.path)
      onClose()
    } catch (error) {
      console.error('创建项目失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async (path: string) => {
    setLoading(true)
    try {
      const project = await openProject(path)
      addRecentProject({
        id: project.id,
        name: project.name,
        path: project.path,
        lastOpened: new Date()
      })
      onProjectOpened?.(project.path)
      onClose()
    } catch (error) {
      console.error('打开项目失败:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('INVALID_PROJECT')) {
        Modal.error({
          title: '无效的项目文件夹',
          content: '该文件夹不是有效的 Novel Writer 项目。请选择包含 .novelwriter.json 配置文件的文件夹。',
          okText: '确定',
          width: 400,
          className: 'dark-modal',
          styles: {
            content: { background: '#1e1e1e', color: '#d4d4d4', borderRadius: 8 },
            header: { background: '#1e1e1e', borderBottom: '1px solid #333', color: '#d4d4d4', borderRadius: '8px 8px 0 0' },
            body: { background: '#1e1e1e', color: '#d4d4d4' }
          },
          maskStyle: { background: 'rgba(0, 0, 0, 0.7)' },
          okButtonProps: {
            style: { background: '#0d419d', borderColor: '#1f6feb', color: '#fff' }
          }
        })
      } else {
        Modal.error({
          title: '打开项目失败',
          content: errorMessage,
          okText: '确定',
          className: 'dark-modal',
          styles: {
            content: { background: '#1e1e1e', color: '#d4d4d4', borderRadius: 8 },
            header: { background: '#1e1e1e', borderBottom: '1px solid #333', color: '#d4d4d4', borderRadius: '8px 8px 0 0' },
            body: { background: '#1e1e1e', color: '#d4d4d4' }
          },
          maskStyle: { background: 'rgba(0, 0, 0, 0.7)' },
          okButtonProps: {
            style: { background: '#0d419d', borderColor: '#1f6feb', color: '#fff' }
          }
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleOpenCustom = async () => {
    const path = await openDirectory()
    if (path) {
      await handleOpen(path)
    }
  }

  const renderCreateContent = () => {
    if (step === 'templates') {
      return (
        <div>
          <Text style={{ color: '#888', marginBottom: 16, display: 'block' }}>
            选择项目类型
          </Text>
          <div style={{ display: 'flex', gap: 12 }}>
            {templates.map((template) => (
              <div
                key={template.type}
                onClick={() => handleSelectTemplate(template.type)}
                style={{
                  flex: 1,
                  padding: '20px 16px',
                  background: '#2d2d2d',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: `2px solid ${selectedTemplate === template.type ? '#58a6ff' : 'transparent'}`,
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8, color: '#58a6ff' }}>
                  {template.icon}
                </div>
                <Text strong style={{ color: '#d4d4d4', display: 'block' }}>
                  {template.name}
                </Text>
                <Text style={{ color: '#888', fontSize: 12 }}>
                  {template.description}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text strong style={{ color: '#d4d4d4' }}>项目名称</Text>
          <Input
            placeholder="输入项目名称"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={{ marginTop: 8, background: '#2d2d2d', color: '#d4d4d4', borderColor: '#444' }}
          />
        </div>
        <div>
          <Text strong style={{ color: '#d4d4d4' }}>项目路径</Text>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Input
              placeholder="选择项目路径"
              value={projectPath}
              readOnly
              style={{ flex: 1, background: '#2d2d2d', color: '#d4d4d4', borderColor: '#444' }}
            />
            <Button
              onClick={handleSelectPath}
              style={{
                background: '#0d419d',
                borderColor: '#1f6feb',
                color: '#fff'
              }}
            >
              浏览
            </Button>
          </Space>
        </div>
      </Space>
    )
  }

  const renderOpenContent = () => (
    <div>
      <Space style={{ width: '100%', marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          onClick={handleOpenCustom}
          style={{
            background: '#0d419d',
            borderColor: '#1f6feb',
            color: '#fff'
          }}
        >
          选择文件夹
        </Button>
      </Space>

      <Divider style={{ borderColor: '#333' }} />

      {recentList.length > 0 ? (
        <List
          dataSource={recentList}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '12px',
                borderRadius: 4,
                marginBottom: 4,
                background: '#2d2d2d',
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => handleOpen(item.path)}
            >
              <List.Item.Meta
                avatar={<FolderOpenOutlined style={{ fontSize: 24, color: '#58a6ff' }} />}
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
        />
      )}
    </div>
  )

  const getTitle = () => {
    if (mode === 'create') {
      return step === 'templates' ? '新建项目' : '项目配置'
    }
    return '打开项目'
  }

  const getOkText = () => {
    if (mode === 'create') {
      return step === 'templates' ? '下一步' : '创建'
    }
    return undefined
  }

  const handleOk = () => {
    if (mode === 'create') {
      if (step === 'templates') {
        setStep('config')
      } else {
        handleCreate()
      }
    }
  }

  const handleCancel = () => {
    if (mode === 'create' && step === 'config') {
      setStep('templates')
    } else {
      onClose()
    }
  }

  const getCancelText = () => {
    if (mode === 'create' && step === 'config') {
      return '上一步'
    }
    return '取消'
  }

  return (
    <Modal
      title={<span style={{ color: '#d4d4d4' }}>{getTitle()}</span>}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText={getOkText()}
      cancelText={getCancelText()}
      width={mode === 'create' ? 600 : 500}
      styles={{
        content: { background: '#1e1e1e', color: '#d4d4d4' },
        header: { background: '#1e1e1e', borderBottom: '1px solid #333', color: '#d4d4d4' },
        body: { background: '#1e1e1e' }
      }}
      okButtonProps={{
        style: {
          background: '#0d419d',
          borderColor: '#1f6feb',
          color: '#fff'
        }
      }}
      cancelButtonProps={{
        style: {
          background: '#2d2d2d',
          borderColor: '#444',
          color: '#d4d4d4'
        }
      }}
    >
      {mode === 'create' ? renderCreateContent() : renderOpenContent()}
    </Modal>
  )
}

export default ProjectDialog

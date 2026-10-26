import React, { useState, useEffect } from 'react'
import { Modal, Input, Space, Typography, Button, Divider, List, Empty } from 'antd'
import {
  FolderOpenOutlined,
  BookOutlined,
  FileTextOutlined,
  HighlightOutlined
} from '@ant-design/icons'
import type { ProjectType, ProjectData } from '@/common/ipc'
import { useProject, useDialog } from '../../hooks/useIPC'
import { useProjectStore } from '../../stores'
import { describeBookError } from '../../services/bookErrors'

const { Text } = Typography

interface ProjectDialogProps {
  open: boolean
  mode: 'create' | 'open'
  onClose: () => void
  onProjectCreated?: (project: ProjectData) => void
  onProjectOpened?: (project: ProjectData) => void
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
  const { createProject, openProject } = useProject()
  const { openDirectory } = useDialog()
  // 最近项目唯一真源：store（persist localStorage），读取与写入都走这里
  const { recentProjects: recentList, addRecentProject } = useProjectStore()

  const [step, setStep] = useState<'templates' | 'config' | 'location'>('templates')
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectType>('novel')
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [errorModalContent, setErrorModalContent] = useState('')
  const [errorModalTitle, setErrorModalTitle] = useState('无效的项目文件夹')

  useEffect(() => {
    if (open && mode === 'create') {
      setStep('templates')
      setProjectName('')
      setProjectPath('')
    }
  }, [open, mode])

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
        id: project.path,
        name: project.name,
        path: project.path,
        lastOpened: new Date().toISOString()
      })
      onProjectCreated?.(project)
      onClose()
    } catch (error) {
      console.error('创建项目失败:', error)
      // Task 10-E：BOOK_EXISTS（create 进已有书的目录）走统一 v2 文案（此前仅 console.error，静默失败）
      const { title, content } = describeBookError(error instanceof Error ? error.message : String(error))
      setErrorModalTitle(title)
      setErrorModalContent(content)
      setErrorModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async (path: string) => {
    setLoading(true)
    try {
      const project = await openProject(path)
      addRecentProject({
        id: project.path,
        name: project.name,
        path: project.path,
        lastOpened: new Date().toISOString()
      })
      onProjectOpened?.(project)
      onClose()
    } catch (error) {
      console.error('打开项目失败:', error)
      // Task 10-E：INVALID_PROJECT/CORRUPT_BOOK/BOOK_EXISTS 统一前缀→可读文案（v2 目录语义）
      const { title, content } = describeBookError(error instanceof Error ? error.message : String(error))
      setErrorModalTitle(title)
      setErrorModalContent(content)
      setErrorModalOpen(true)
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
          <Text style={{ color: 'var(--color-text-secondary)', marginBottom: 16, display: 'block' }}>
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
                  background: 'var(--color-bg-container)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: `2px solid ${selectedTemplate === template.type ? 'var(--color-primary)' : 'transparent'}`,
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--color-primary)' }}>
                  {template.icon}
                </div>
                <Text strong style={{ color: 'var(--color-text)', display: 'block' }}>
                  {template.name}
                </Text>
                <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
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
          <Text strong style={{ color: 'var(--color-text)' }}>项目名称</Text>
          <Input
            placeholder="输入项目名称"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={{ marginTop: 8, background: 'var(--color-bg-container)', color: 'var(--color-text)', borderColor: 'var(--color-border-secondary)' }}
          />
        </div>
        <div>
          <Text strong style={{ color: 'var(--color-text)' }}>项目路径</Text>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Input
              placeholder="选择项目路径"
              value={projectPath}
              readOnly
              style={{ flex: 1, background: 'var(--color-bg-container)', color: 'var(--color-text)', borderColor: 'var(--color-border-secondary)' }}
            />
            <Button
              onClick={handleSelectPath}
              style={{
                background: 'var(--color-primary-bg)',
                borderColor: 'var(--color-primary-border)',
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
            background: 'var(--color-primary-bg)',
            borderColor: 'var(--color-primary-border)',
            color: '#fff'
          }}
        >
          选择文件夹
        </Button>
      </Space>

      <Divider style={{ borderColor: 'var(--color-border)' }} />

      {recentList.length > 0 ? (
        <List
          dataSource={recentList}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '12px',
                borderRadius: 4,
                marginBottom: 4,
                background: 'var(--color-bg-container)',
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => handleOpen(item.path)}
            >
              <List.Item.Meta
                avatar={<FolderOpenOutlined style={{ fontSize: 24, color: 'var(--color-primary)' }} />}
                title={<Text style={{ color: 'var(--color-text)' }}>{item.name}</Text>}
                description={<Text style={{ color: 'var(--color-text-secondary)' }}>{item.path}</Text>}
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
    <>
      {/* 错误提示弹窗（标题随错误类别变化：无效项目/已存在一本书/数据损坏） */}
      <Modal
        title={<span style={{ color: 'var(--color-text)' }}>{errorModalTitle}</span>}
        open={errorModalOpen}
        onOk={() => setErrorModalOpen(false)}
        onCancel={() => setErrorModalOpen(false)}
        okText="确定"
        width={400}
        className="dark-modal"
        styles={{
          content: { background: 'var(--color-bg-elevated)', color: 'var(--color-text)', borderRadius: 8 },
          header: { background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
          body: { background: 'var(--color-bg-elevated)', color: 'var(--color-text)' },
          mask: { background: 'var(--color-mask-bg)' }
        }}
        okButtonProps={{
          style: { background: 'var(--color-primary-bg)', borderColor: 'var(--color-primary-border)', color: '#fff' }
        }}
      >
        <div style={{ color: 'var(--color-text)', fontSize: 14 }}>
          {errorModalContent}
        </div>
      </Modal>

      {/* 主弹窗 */}
      <Modal
      title={<span style={{ color: 'var(--color-text)' }}>{getTitle()}</span>}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText={getOkText()}
      cancelText={getCancelText()}
      width={mode === 'create' ? 600 : 500}
      styles={{
        content: { background: 'var(--color-bg-base)', color: 'var(--color-text)' },
        header: { background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
        body: { background: 'var(--color-bg-base)' }
      }}
      okButtonProps={{
        style: {
          background: 'var(--color-primary-bg)',
          borderColor: 'var(--color-primary-border)',
          color: '#fff'
        }
      }}
      cancelButtonProps={{
        style: {
          background: 'var(--color-bg-container)',
          borderColor: 'var(--color-border-secondary)',
          color: 'var(--color-text)'
        }
      }}
    >
      {mode === 'create' ? renderCreateContent() : renderOpenContent()}
    </Modal>
    </>
  )
}

export default ProjectDialog

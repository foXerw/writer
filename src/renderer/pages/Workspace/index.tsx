import React, { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layout, Button, Space, Tree, Typography, App } from 'antd'
import {
  FileTextOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  UserOutlined,
  BookOutlined
} from '@ant-design/icons'
import MonacoEditor from '../../components/Editor/MonacoEditor'
import EditorToolbar from '../../components/Editor/EditorToolbar'
import EditorTabs from '../../components/Layout/EditorTabs'
import type { Chapter } from '../../common/ipc'
import { useChapter } from '../../hooks/useIPC'

const { Header, Content, Sider } = Layout
const { Title, Text } = Typography

interface WorkspaceState {
  project?: { name: string; path: string }
  projectPath?: string
}

function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as WorkspaceState
  const { message } = App.useApp()

  const { getAllChapters, createChapter, updateChapter } = useChapter()

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [openedChapters, setOpenedChapters] = useState<Chapter[]>([])
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const projectPath = state?.project?.path || state?.projectPath
  const projectName = state?.project?.name || '未命名项目'

  // 加载章节列表
  useEffect(() => {
    if (projectPath) {
      loadChapters()
    }
  }, [projectPath])

  const loadChapters = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const data = await getAllChapters(projectPath)
      setChapters(data)
      // 默认打开第一个章节
      if (data.length > 0) {
        const firstChapter = data[0]
        setOpenedChapters([firstChapter])
        selectChapter(firstChapter)
      }
    } catch (error) {
      console.error('加载章节失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 打开章节（添加到Tab栏）
  const handleOpenChapter = (chapter: Chapter) => {
    setOpenedChapters(prev => {
      if (prev.find(c => c.id === chapter.id)) {
        return prev
      }
      return [...prev, chapter]
    })
    selectChapter(chapter)
  }

  // 关闭章节（从Tab栏移除）
  const handleCloseChapter = (chapterId: string) => {
    setOpenedChapters(prev => {
      const filtered = prev.filter(c => c.id !== chapterId)
      // 如果关闭的是当前章节，切换到下一个
      if (currentChapter?.id === chapterId && filtered.length > 0) {
        selectChapter(filtered[0])
      }
      return filtered
    })
  }

  // 保存章节
  const handleSaveChapter = (chapter: Chapter) => {
    handleSave()
  }

  // 选择章节
  const selectChapter = (chapter: Chapter) => {
    setCurrentChapter(chapter)
    setEditorContent(chapter.content)
    setChapterTitle(chapter.title)
  }

  // 新建章节
  const handleCreateChapter = async () => {
    if (!projectPath) return
    const title = `新章节 ${chapters.length + 1}`
    try {
      const newChapter = await createChapter(projectPath, title)
      setChapters([...chapters, newChapter])
      selectChapter(newChapter)
      message.success('章节创建成功')
    } catch (error) {
      message.error('章节创建失败')
    }
  }

  // 保存章节
  const handleSave = async () => {
    if (!currentChapter || !projectPath) return
    try {
      const updated = await updateChapter(projectPath, {
        ...currentChapter,
        title: chapterTitle,
        content: editorContent
      })
      setCurrentChapter(updated)
      // 更新列表中的章节
      setChapters(chapters.map(c => c.id === updated.id ? updated : c))
      message.success('保存成功')
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 返回首页
  const handleBack = () => {
    navigate('/')
  }

  // 转换章节为树数据
  const treeData = chapters.map(chapter => ({
    key: chapter.id,
    title: chapter.title || '无标题',
    icon: <FileTextOutlined />
  }))

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧边栏 */}
      <Sider
        width={240}
        collapsedWidth={48}
        collapsed={sidebarCollapsed}
        theme="dark"
        style={{ background: '#252526' }}
      >
        <div style={{
          padding: sidebarCollapsed ? '16px 0' : '16px',
          borderBottom: '1px solid #333'
        }}>
          <Space>
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={handleBack}
              style={{ color: '#d4d4d4' }}
            />
            {!sidebarCollapsed && (
              <Text style={{ color: '#d4d4d4', fontWeight: 500 }}>
                {projectName}
              </Text>
            )}
          </Space>
        </div>

        {!sidebarCollapsed && (
          <>
            {/* 章节列表 */}
            <div style={{ padding: '16px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Text style={{ color: '#888', fontSize: 12 }}>章节</Text>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={handleCreateChapter}
                  block
                  style={{ borderColor: '#444', color: '#888' }}
                >
                  新建章节
                </Button>
              </Space>
            </div>

            <Tree
              treeData={treeData}
              selectedKeys={currentChapter ? [currentChapter.id] : []}
              onSelect={([key]) => {
                const chapter = chapters.find(c => c.id === key)
                if (chapter) handleOpenChapter(chapter)
              }}
              style={{ padding: '0 8px' }}
            />
          </>
        )}
      </Sider>

      {/* 主内容区 */}
      <Layout>
        {/* Tab栏 */}
        <EditorTabs
          chapters={openedChapters}
          currentChapter={currentChapter}
          onSelectChapter={handleOpenChapter}
          onCloseChapter={handleCloseChapter}
          onSaveChapter={handleSaveChapter}
        />
        {/* 工具栏 */}
        <Header style={{
          padding: 0,
          background: '#1e1e1e',
          height: 'auto',
          lineHeight: 'normal'
        }}>
          <EditorToolbar
            onSave={handleSave}
            chapterTitle={chapterTitle}
            onTitleChange={setChapterTitle}
            wordCount={editorContent.length}
            focusMode={focusMode}
            typewriterMode={typewriterMode}
            onToggleFocus={setFocusMode}
            onToggleTypewriter={setTypewriterMode}
          />
        </Header>

        {/* 编辑器 */}
        <Content style={{ background: '#1e1e1e', padding: 0 }}>
          {currentChapter ? (
            <MonacoEditor
              value={editorContent}
              onChange={setEditorContent}
              onSave={handleSave}
            />
          ) : (
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666'
            }}>
              <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <Text style={{ color: '#888' }}>
                {chapters.length === 0 ? '暂无章节，点击新建章节开始创作' : '选择一个章节开始编辑'}
              </Text>
              {chapters.length === 0 && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleCreateChapter}
                  style={{ marginTop: 16 }}
                >
                  新建章节
                </Button>
              )}
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  )
}

export default Workspace

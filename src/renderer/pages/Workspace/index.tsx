import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layout, Button, Space, Typography, App } from 'antd'
import {
  FileTextOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  UserOutlined,
  SettingOutlined,
  BarChartOutlined,
  BookOutlined,
  LeftOutlined
} from '@ant-design/icons'
import MonacoEditor from '../../components/Editor/MonacoEditor'
import EditorToolbar from '../../components/Editor/EditorToolbar'
import EditorTabs from '../../components/Layout/EditorTabs'
import ChapterTree from '../../components/Explorer/ChapterTree'
import CharacterPanel from '../../components/Explorer/CharacterPanel'
import SettingPanel from '../../components/Explorer/SettingPanel'
import StatsPanel from '../../components/Explorer/StatsPanel'
import CommandPalette from '../../components/Dialogs/CommandPalette'
import OutlineView from '../../components/Editor/OutlineView'
import type { MonacoEditorHandle } from '../../components/Editor/MonacoEditor'
import { useMenu } from '../../hooks/useMenu'
import { startAutoSave, stopAutoSave } from '../../services/ipcService'
import { useEditorStore } from '../../stores'
import { useChapter } from '../../hooks/useIPC'
import { useKeyboard } from '../../hooks/useKeyboard'
import type { Chapter, ProjectConfig } from '@/common/ipc'

const { Header, Content, Sider } = Layout
const { Text, Title } = Typography

interface WorkspaceState {
  project?: { name: string; path: string }
  projectPath?: string
  config?: ProjectConfig
}

type SidebarTab = 'chapters' | 'characters' | 'settings' | 'stats'

function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as WorkspaceState
  const { message } = App.useApp()

  const { fontSize, wordWrap, showLineNumbers } = useEditorStore()
  const editorRef = useRef<MonacoEditorHandle>(null)

  const { getAllChapters, createChapter, updateChapter, deleteChapter } = useChapter()

  // 侧边栏状态
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // 章节状态
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [openedChapters, setOpenedChapters] = useState<Chapter[]>([])
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')

  // 模式状态
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)

  // 命令面板
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)

  const [loading, setLoading] = useState(false)

  const projectPath = state?.project?.path || state?.projectPath
  const projectName = state?.project?.name || '未命名项目'
  const config = state?.config
  const autoSaveEnabled = config?.autoSave ?? true
  const autoSaveInterval = config?.autoSaveInterval ?? 30000
  const isDirtyRef = useRef(false)
  const editorContentRef = useRef(editorContent)
  useEffect(() => {
    editorContentRef.current = editorContent
  }, [editorContent])

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

  // 打开章节
  const handleOpenChapter = (chapter: Chapter) => {
    setOpenedChapters(prev => {
      if (prev.find(c => c.id === chapter.id)) {
        return prev
      }
      return [...prev, chapter]
    })
    selectChapter(chapter)
  }

  // 关闭章节
  const handleCloseChapter = (chapterId: string) => {
    setOpenedChapters(prev => {
      const filtered = prev.filter(c => c.id !== chapterId)
      if (currentChapter?.id === chapterId && filtered.length > 0) {
        selectChapter(filtered[0])
      }
      return filtered
    })
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
      handleOpenChapter(newChapter)
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
      setChapters(chapters.map(c => c.id === updated.id ? updated : c))
      isDirtyRef.current = false
      message.success('保存成功')
    } catch (error) {
      message.error('保存失败')
    }
  }

  const handleSaveRef = useRef(handleSave)
  useEffect(() => {
    handleSaveRef.current = handleSave
  })

  // 编辑器内容变化包装：置 dirty
  const handleEditorChange = (val: string) => {
    setEditorContent(val)
    isDirtyRef.current = true
  }

  // 自动保存：按配置间隔写盘
  useEffect(() => {
    if (!currentChapter || !autoSaveEnabled) return
    startAutoSave({
      interval: autoSaveInterval,
      onSave: () => {
        if (isDirtyRef.current) {
          void handleSaveRef.current()
        }
        return editorContentRef.current
      }
    })
    return () => stopAutoSave()
  }, [currentChapter?.id, autoSaveEnabled, autoSaveInterval])

  // 删除章节
  const handleDeleteChapter = async (chapterId: string) => {
    if (!projectPath) return
    try {
      await deleteChapter(projectPath, chapterId)
      setChapters(chapters.filter(c => c.id !== chapterId))
      setOpenedChapters(prev => prev.filter(c => c.id !== chapterId))
      if (currentChapter?.id === chapterId) {
        setCurrentChapter(null)
        setEditorContent('')
        setChapterTitle('')
      }
      message.success('章节已删除')
    } catch (error) {
      message.error('删除失败')
    }
  }

  // 返回首页
  const handleBack = () => {
    navigate('/')
  }

  // 命令面板处理
  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case 'file:save':
        handleSave()
        break
      case 'chapter:new':
        handleCreateChapter()
        break
      case 'view:focusMode':
        setFocusMode(prev => !prev)
        break
      case 'view:typewriterMode':
        setTypewriterMode(prev => !prev)
        break
      default:
        console.log('Unknown command:', command)
    }
  }, [chapters, focusMode, typewriterMode])

  // 菜单栏事件
  useMenu((event, ...args) => {
    switch (event) {
      case 'newChapter':
        handleCreateChapter()
        break
      case 'save':
        handleSave()
        break
      case 'focusMode':
        setFocusMode(args[0] as boolean)
        break
      case 'typewriterMode':
        setTypewriterMode(args[0] as boolean)
        break
      case 'toggleOutline':
        setOutlineVisible((v) => !v)
        break
      case 'toggleChapterTree':
        setSidebarCollapsed((v) => !v)
        break
      default:
        console.log('未处理的菜单事件:', event)
    }
  })

  // 键盘快捷键
  useKeyboard({
    onSave: handleSave,
    onNew: handleCreateChapter,
    onToggleFocusMode: () => setFocusMode(prev => !prev),
    onToggleTypewriterMode: () => setTypewriterMode(prev => !prev),
    onToggleCommandPalette: () => setCommandPaletteOpen(prev => !prev),
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onOutline: () => setOutlineVisible((v) => !v)
  })

  // 侧边栏Tab配置
  const sidebarTabs = [
    { key: 'chapters', label: '章节', icon: <FileTextOutlined /> },
    { key: 'characters', label: '角色', icon: <UserOutlined /> },
    { key: 'settings', label: '设定', icon: <SettingOutlined /> },
    { key: 'stats', label: '统计', icon: <BarChartOutlined /> }
  ]

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 命令面板 */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onExecute={handleCommand}
      />

      {/* 左侧边栏 */}
      <Sider
        width={sidebarCollapsed ? 0 : 280}
        collapsedWidth={48}
        collapsed={sidebarCollapsed || focusMode}
        theme="dark"
        style={{ background: '#252526', overflow: 'hidden' }}
      >
        {/* 顶部项目信息 */}
        <div style={{
          padding: sidebarCollapsed ? '12px 0' : '12px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between'
        }}>
          {!sidebarCollapsed && (
            <Space>
              <Button
                type="text"
                icon={<LeftOutlined />}
                onClick={handleBack}
                style={{ color: '#d4d4d4' }}
              />
              <Text style={{ color: '#d4d4d4', fontWeight: 500, fontSize: 13 }} ellipsis>
                {projectName}
              </Text>
            </Space>
          )}
          {sidebarCollapsed && (
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={handleBack}
              style={{ color: '#d4d4d4' }}
            />
          )}
        </div>

        {/* 侧边栏Tab */}
        {!sidebarCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 50px)' }}>
            {/* Tab按钮栏 */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid #333',
              background: '#1e1e1e'
            }}>
              {sidebarTabs.map(tab => (
                <Button
                  key={tab.key}
                  type="text"
                  onClick={() => setSidebarTab(tab.key as SidebarTab)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 0,
                    color: sidebarTab === tab.key ? '#fff' : '#888',
                    background: sidebarTab === tab.key ? '#252526' : 'transparent',
                    borderBottom: sidebarTab === tab.key ? '2px solid #1890ff' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    fontSize: 12
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </Button>
              ))}
            </div>

            {/* Tab内容区 */}
            <div style={{ flex: 1, overflow: 'auto', background: '#252526' }}>
              {sidebarTab === 'chapters' && (
                <ChapterTree
                  projectPath={projectPath || ''}
                  chapters={chapters}
                  selectedChapterId={currentChapter?.id}
                  onSelectChapter={handleOpenChapter}
                  onChapterChange={loadChapters}
                />
              )}
              {sidebarTab === 'characters' && (
                <CharacterPanel
                  projectPath={projectPath || ''}
                />
              )}
              {sidebarTab === 'settings' && (
                <SettingPanel
                  projectPath={projectPath || ''}
                />
              )}
              {sidebarTab === 'stats' && (
                <StatsPanel
                  todayWordCount={editorContent.length}
                  totalWordCount={chapters.reduce((sum, c) => sum + c.wordCount, 0)}
                />
              )}
            </div>
          </div>
        )}

        {/* 收起按钮 */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '8px',
          borderTop: '1px solid #333',
          textAlign: 'center'
        }}>
          <Button
            type="text"
            icon={sidebarCollapsed ? <FolderOpenOutlined /> : <FolderOpenOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ color: '#666' }}
          />
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout>
        {/* Tab栏 */}
        <EditorTabs
          chapters={openedChapters}
          currentChapter={currentChapter}
          onSelectChapter={handleOpenChapter}
          onCloseChapter={handleCloseChapter}
          onSaveChapter={handleSave}
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

        {/* 编辑器 + 大纲 */}
        <Layout>
          <Content style={{ background: '#1e1e1e', padding: 0, flex: 1 }}>
            {currentChapter ? (
              <MonacoEditor
                ref={editorRef}
                value={editorContent}
                onChange={handleEditorChange}
                onSave={handleSave}
                focusMode={focusMode}
                typewriterMode={typewriterMode}
                fontSize={fontSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
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

          {outlineVisible && currentChapter && (
            <Sider
              width={260}
              theme="dark"
              style={{ background: '#252526', borderLeft: '1px solid #333', overflow: 'auto' }}
            >
              <OutlineView
                content={editorContent}
                onNavigateToLine={(ln) => editorRef.current?.revealLineInCenter(ln)}
              />
            </Sider>
          )}
        </Layout>
      </Layout>
    </Layout>
  )
}

export default Workspace

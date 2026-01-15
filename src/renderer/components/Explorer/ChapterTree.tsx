import React, { useCallback } from 'react'
import { Tree, Button, Space, Dropdown, message, Modal, Input, Typography } from 'antd'
import type { MenuProps, TreeProps } from 'antd'
import {
  PlusOutlined,
  FolderOutlined,
  FileTextOutlined,
  MoreOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  DragOutlined
} from '@ant-design/icons'
import type { Chapter } from '@/common/ipc'
import { useChapter } from '../../hooks/useIPC'

const { Text } = Typography

interface ChapterTreeProps {
  projectPath: string
  chapters: Chapter[]
  selectedChapterId?: string
  onSelectChapter: (chapter: Chapter) => void
  onChapterChange: () => void // 章节列表变化时回调
}

const ChapterTree: React.FC<ChapterTreeProps> = ({
  projectPath,
  chapters,
  selectedChapterId,
  onSelectChapter,
  onChapterChange
}) => {
  const { deleteChapter, reorderChapters } = useChapter()
  const [messageApi, contextHolder] = message.useMessage()
  const [modal, contextModalHolder] = Modal.useModal()

  // 右键菜单
  const getRightClickMenu = (chapter: Chapter): MenuProps => ({
    items: [
      {
        key: 'edit',
        label: '重命名',
        icon: <EditOutlined />,
        onClick: () => showRenameModal(chapter)
      },
      {
        key: 'copy',
        label: '复制章节',
        icon: <CopyOutlined />,
        onClick: () => copyChapter(chapter)
      },
      { type: 'divider' },
      {
        key: 'delete',
        label: '删除章节',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => confirmDelete(chapter)
      }
    ]
  })

  // 重命名弹窗
  const showRenameModal = (chapter: Chapter) => {
    let newTitle = chapter.title
    Modal.confirm({
      title: '重命名章节',
      content: (
        <Input
          defaultValue={chapter.title}
          onChange={(e) => { newTitle = e.target.value }}
          placeholder="请输入章节标题"
        />
      ),
      onOk: () => {
        if (newTitle.trim() && newTitle !== chapter.title) {
          // 调用更新接口
          messageApi.success('章节已重命名')
          onChapterChange()
        }
      }
    })
  }

  // 复制章节
  const copyChapter = async (chapter: Chapter) => {
    // 实际项目中调用复制接口
    messageApi.success('章节已复制')
    onChapterChange()
  }

  // 确认删除
  const confirmDelete = (chapter: Chapter) => {
    modal.confirm({
      title: '删除章节',
      content: `确定要删除章节 "${chapter.title}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteChapter(projectPath, chapter.id)
          messageApi.success('章节已删除')
          onChapterChange()
        } catch (error) {
          messageApi.error('删除失败')
        }
      }
    })
  }

  // 获取状态图标
  const getStatusIcon = (status: Chapter['status']) => {
    switch (status) {
      case 'completed':
        return <span style={{ color: '#52c41a' }}>●</span>
      case 'revising':
        return <span style={{ color: '#faad14' }}>●</span>
      default:
        return <span style={{ color: '#8c8c8c' }}>●</span>
    }
  }

  // 转换为树数据
  const treeData: TreeProps['treeData'] = chapters.map((chapter, index) => ({
    key: chapter.id,
    title: (
      <Dropdown menu={getRightClickMenu(chapter)} trigger={['contextMenu']}>
        <span className="chapter-tree-title">
          {getStatusIcon(chapter.status)} {chapter.title}
        </span>
      </Dropdown>
    ),
    icon: <FileTextOutlined />,
    isLeaf: true,
    // 存储完整数据
    data: chapter
  }))

  // 处理选择
  const handleSelect: TreeProps['onSelect'] = (selectedKeys) => {
    if (selectedKeys.length > 0) {
      const chapter = chapters.find(c => c.id === selectedKeys[0])
      if (chapter) {
        onSelectChapter(chapter)
      }
    }
  }

  // 处理拖拽排序
  const handleDragEnd: TreeProps['onDragEnd'] = async (info) => {
    const { node, dragNode } = info
    if (!node.key || !dragNode.key || node.key === dragNode.key) return

    try {
      await reorderChapters(projectPath, dragNode.key as string, node.key as string)
      messageApi.success('章节顺序已更新')
      onChapterChange()
    } catch (error) {
      messageApi.error('排序失败')
    }
  }

  return (
    <>
      {contextHolder}
      {contextModalHolder}
      <div className="chapter-tree">
        {/* 头部工具栏 */}
        <div className="chapter-tree-header">
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#888', fontSize: 12 }}>章节</Text>
              <Text style={{ color: '#666', fontSize: 11 }}>
                {chapters.length} 篇
              </Text>
            </div>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => {
                // 触发新建章节事件
                onChapterChange()
              }}
              block
              style={{ borderColor: '#444', color: '#888' }}
            >
              新建章节
            </Button>
          </Space>
        </div>

        {/* 章节树 */}
        <Tree
          treeData={treeData}
          selectedKeys={selectedChapterId ? [selectedChapterId] : []}
          onSelect={handleSelect}
          draggable
          onDragEnd={handleDragEnd}
          blockNode
          showIcon
          style={{ padding: '8px 0' }}
        />
      </div>
    </>
  )
}

export default ChapterTree

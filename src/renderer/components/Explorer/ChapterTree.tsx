import React, { useCallback, useEffect, useState } from 'react'
import { Tree, Button, Dropdown, message, Modal, Input, Typography } from 'antd'
import type { MenuProps, TreeProps } from 'antd'
import {
  PlusOutlined,
  FileTextOutlined,
  FolderOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined
} from '@ant-design/icons'
import type { Chapter, Volume } from '@/common/ipc'
import { useChapter, useVolume } from '../../hooks/useIPC'
import { VolumeManager } from './VolumeManager'

const { Text } = Typography

/** 未分卷桶的虚拟节点 key（非 UUID，永不与卷/章 id 撞车） */
const UNGROUPED_KEY = '__ungrouped__'

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
  const { createChapter, deleteChapter, renameChapter } = useChapter()
  const { getAllVolumes, moveChapterToVolume } = useVolume()
  const [messageApi, contextHolder] = message.useMessage()
  const [modal, contextModalHolder] = Modal.useModal()

  // 卷列表自持（Task 5）：卷的增删改重排不进 Workspace 会话状态，树内闭环；
  // 但删卷/移章会改章的 volumeId——必须经 onChapterChange 重拉章列表，
  // 防会话里陈旧 volumeId 被下一次自动保存整 Chapter 回写复活。
  const [volumes, setVolumes] = useState<Volume[]>([])
  const refreshVolumes = useCallback(async () => {
    try {
      setVolumes(await getAllVolumes(projectPath))
    } catch (error) {
      setVolumes([]) // 卷侧不可用（无 electron/坏目录）→ 退化为无卷平铺，章树本身仍可用
    }
  }, [projectPath, getAllVolumes])

  useEffect(() => {
    void refreshVolumes()
  }, [refreshVolumes])

  // 移卷后的章归属变更走 onChapterChange（父级重拉），卷自身变更走 refreshVolumes
  const grouped = volumes.length > 0
  const chaptersOfVolume = (volumeId: string) => chapters.filter((c) => c.volumeId === volumeId)
  const volumeIdSet = new Set(volumes.map((v) => v.id))
  // 悬挂引用（指向已消失的卷）与 null 同归未分卷桶——删除路径保证不产生，展示侧再兜一层底
  const ungroupedChapters = chapters.filter(
    (c) => !c.volumeId || !volumeIdSet.has(c.volumeId)
  )

  // 分组节点展开态：新出现的组自动展开（并集），用户手动折叠后保持折叠
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const groupSig = grouped
    ? [...volumes.map((v) => v.id), ...(ungroupedChapters.length > 0 ? [UNGROUPED_KEY] : [])].join('|')
    : ''
  useEffect(() => {
    if (!groupSig) return
    const keys = groupSig.split('|')
    setExpandedKeys((prev) => Array.from(new Set([...prev, ...keys])))
  }, [groupSig])

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
        onClick: () => copyChapter()
      },
      // Task 5：拖拽排序 M1 已移除，移卷走此子菜单（列全部卷 + 未分卷）
      {
        key: 'move',
        label: '移动到卷',
        icon: <FolderOutlined />,
        children: [
          {
            key: 'ungrouped',
            label: '未分卷',
            // 已明确未分卷 → 禁用；悬挂引用不禁（正好借此修复）
            disabled: !chapter.volumeId,
            onClick: () => moveToVolume(chapter, null)
          },
          ...volumes.map((v) => ({
            key: v.id,
            label: v.title,
            disabled: chapter.volumeId === v.id,
            onClick: () => moveToVolume(chapter, v.id)
          }))
        ]
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

  // 移卷（meta-only 写，正文不动——仓库侧 updateChapter 契约）
  const moveToVolume = async (chapter: Chapter, volumeId: string | null) => {
    try {
      await moveChapterToVolume(projectPath, chapter.id, volumeId)
      messageApi.success(volumeId === null ? '已移回未分卷' : '已移动到卷')
      onChapterChange()
    } catch (error) {
      messageApi.error('移动失败')
    }
  }

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
      onOk: async () => {
        if (newTitle.trim() && newTitle !== chapter.title) {
          try {
            await renameChapter(projectPath, chapter.id, newTitle.trim())
            messageApi.success('章节已重命名')
            onChapterChange()
          } catch (error) {
            messageApi.error('重命名失败')
          }
        }
      }
    })
  }

  // 复制章节
  const copyChapter = () => {
    messageApi.info('复制章节功能暂未实现')
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
        return <span style={{ color: 'var(--color-text-secondary)' }}>●</span>
    }
  }

  // 章节点（平铺与分组两模式共用）
  const chapterNode = (chapter: Chapter) => ({
    key: chapter.id,
    title: (
      <Dropdown menu={getRightClickMenu(chapter)} trigger={['contextMenu']}>
        <span className="chapter-tree-title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileTextOutlined style={{ color: 'var(--color-primary)', fontSize: 12 }} />
          {getStatusIcon(chapter.status)}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chapter.title}
          </span>
        </span>
      </Dropdown>
    ),
    isLeaf: true,
    // 存储完整数据
    data: chapter
  })

  // 转换为树数据：无卷 → 平铺（M1 形态，零回归）；有卷 → 卷分组 + 未分卷桶（末位）
  const treeData: TreeProps['treeData'] = (() => {
    if (!grouped) return chapters.map(chapterNode)
    const nodes = volumes.map((v, i) => {
      const kids = chaptersOfVolume(v.id)
      return {
        key: v.id,
        selectable: false, // 卷节点不可选中（选择语义仍 = 打开章；分组变更走右键菜单）
        title: (
          <VolumeManager
            projectPath={projectPath}
            volume={v}
            index={i}
            total={volumes.length}
            chapterCount={kids.length}
            prevId={volumes[i - 1]?.id}
            nextId={volumes[i + 1]?.id}
            onVolumesChanged={() => void refreshVolumes()}
            onChaptersChanged={onChapterChange}
          />
        ),
        // 空卷不给 children=[]：undefined 即无可展开箭头，避免空壳展开态
        children: kids.length > 0 ? kids.map(chapterNode) : undefined
      }
    })
    if (ungroupedChapters.length > 0) {
      nodes.push({
        key: UNGROUPED_KEY,
        selectable: false,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <FolderOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} />
            <Text strong style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              未分卷
            </Text>
            <Text style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              （{ungroupedChapters.length} 章）
            </Text>
          </span>
        ),
        children: ungroupedChapters.map(chapterNode)
      })
    }
    return nodes
  })()

  // 处理选择
  const handleSelect: TreeProps['onSelect'] = (selectedKeys) => {
    if (selectedKeys.length > 0) {
      const chapter = chapters.find(c => c.id === selectedKeys[0])
      if (chapter) {
        onSelectChapter(chapter)
      }
    }
  }

  // 拖拽排序：M1 不提供。此前 Tree 挂了拖拽属性与 onDragEnd 收尾回调，但 rc-tree 在
  // onDragEnd 不传 dragNode，回调恒为 no-op——纯视觉误导，已整体移除；
  // 后端 chapter:reorder 保留，待 M2 用真正的 onDrop 实现接线。

  // 新建章节
  const handleCreateChapter = () => {
    let newTitle = ''
    modal.confirm({
      title: '新建章节',
      content: (
        <Input
          autoFocus
          placeholder="请输入章节标题"
          onChange={(e) => { newTitle = e.target.value }}
          onPressEnter={() => {
            if (newTitle.trim()) {
              modal.confirm({})
              confirmCreateChapter(newTitle)
            }
          }}
        />
      ),
      okText: '创建',
      cancelText: '取消',
      onOk: () => confirmCreateChapter(newTitle)
    })
  }

  const confirmCreateChapter = async (title: string) => {
    if (!title.trim()) return
    try {
      // 种子卷 = 当前选中章的卷（Task 5 裁定：简单直通，取不到归未分卷）
      const seedVolumeId = chapters.find((c) => c.id === selectedChapterId)?.volumeId ?? null
      await createChapter(projectPath, title.trim(), seedVolumeId)
      messageApi.success('章节已创建')
      onChapterChange()
    } catch (error) {
      messageApi.error('创建失败')
    }
  }

  return (
    <>
      {contextHolder}
      {contextModalHolder}
      <div className="chapter-tree">
        {/* 头部工具栏 */}
        <div className="chapter-tree-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong style={{ color: 'var(--color-text)', fontSize: 13 }}>章节</Text>
            <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
              {chapters.length} 篇
            </Text>
          </div>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={handleCreateChapter}
            block
            style={{ borderColor: 'var(--color-border-secondary)', color: 'var(--color-text-secondary)' }}
          >
            新建章节
          </Button>
        </div>

        {/* 章节树（卷分组见上） */}
        <Tree
          treeData={treeData}
          selectedKeys={selectedChapterId ? [selectedChapterId] : []}
          onSelect={handleSelect}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys)}
          blockNode
          showIcon
          style={{ padding: '8px 12px' }}
        />
      </div>
    </>
  )
}

export default ChapterTree

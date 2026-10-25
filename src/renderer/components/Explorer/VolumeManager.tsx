import React from 'react'
import { Dropdown, Modal, Input, message, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons'
import type { Volume } from '@/common/ipc'
import { useVolume } from '../../hooks/useIPC'

const { Text } = Typography

interface VolumeManagerProps {
  projectPath: string
  volume: Volume
  /** 卷在有序列表中的下标（配合 total 判定上移/下移可用边界） */
  index: number
  total: number
  /** 该卷下章数（节点标题 `title（N 章）` 与删除确认文案共用） */
  chapterCount: number
  /** 相邻卷 id：上移=与 prevId 换槽，下移=与 nextId 换槽（reorder 的 fromId/toId 语义） */
  prevId?: string
  nextId?: string
  /** 卷列表变化后回调（重拉 volumes） */
  onVolumesChanged: () => void
  /** 章节归属变化后回调（删卷会疏散其下章 → 并入会话 + 重拉列表，见 ChapterTree 双保险注释） */
  onChaptersChanged: () => void
}

/**
 * 卷头右键菜单组件（Task 5 裁定：独立文件供 ChapterTree 复用）。
 * 节点 = `title（N 章）`，右键 = 新建/重命名/删除(二次确认)/上移/下移。
 * 删除确认文案必须含「其下 N 章将回到未分卷」——删卷语义 = 疏散而非连坐，
 * 无孤儿保证在卷仓库 deleteVolume（先逐章 volumeId→null 后删卷档，任一失败整体中止）。
 */
export const VolumeManager: React.FC<VolumeManagerProps> = ({
  projectPath,
  volume,
  index,
  total,
  chapterCount,
  prevId,
  nextId,
  onVolumesChanged,
  onChaptersChanged
}) => {
  const { createVolume, renameVolume, deleteVolume, reorderVolumes } = useVolume()
  const [messageApi, contextHolder] = message.useMessage()
  const [modal, modalHolder] = Modal.useModal()

  const run = async (
    fn: () => Promise<unknown>,
    okText: string,
    errText: string,
    alsoChaptersChanged = false
  ) => {
    try {
      await fn()
      messageApi.success(okText)
      onVolumesChanged()
      if (alsoChaptersChanged) onChaptersChanged()
    } catch (error) {
      messageApi.error(errText)
    }
  }

  /** 卷标题输入弹窗（沿用 ChapterTree 既有 confirm+Input 惯用法） */
  const promptTitle = (title: string, initial: string, onSubmit: (t: string) => void) => {
    let value = initial
    modal.confirm({
      title,
      content: (
        <Input
          autoFocus
          defaultValue={initial}
          placeholder="请输入卷标题"
          onChange={(e) => {
            value = e.target.value
          }}
        />
      ),
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        if (value.trim()) onSubmit(value.trim())
      }
    })
  }

  const menu: MenuProps = {
    items: [
      {
        key: 'create',
        label: '新建卷',
        icon: <PlusOutlined />,
        onClick: () => promptTitle('新建卷', '', (t) => run(() => createVolume(projectPath, t), '卷已创建', '创建卷失败'))
      },
      {
        key: 'rename',
        label: '重命名',
        icon: <EditOutlined />,
        onClick: () =>
          promptTitle('重命名卷', volume.title, (t) =>
            run(() => renameVolume(projectPath, volume.id, t), '卷已重命名', '重命名失败')
          )
      },
      {
        key: 'delete',
        label: '删除卷',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () =>
          modal.confirm({
            title: '删除卷',
            content: `确定要删除卷「${volume.title}」吗？其下 ${chapterCount} 章将回到未分卷，此操作不可恢复。`,
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            onOk: () =>
              run(() => deleteVolume(projectPath, volume.id), '卷已删除', '删除失败（章未疏散则卷不删）', true)
          })
      },
      { type: 'divider' },
      {
        key: 'up',
        label: '上移',
        icon: <ArrowUpOutlined />,
        disabled: index === 0 || !prevId,
        onClick: () =>
          prevId && run(() => reorderVolumes(projectPath, volume.id, prevId), '已上移', '上移失败')
      },
      {
        key: 'down',
        label: '下移',
        icon: <ArrowDownOutlined />,
        disabled: index >= total - 1 || !nextId,
        onClick: () =>
          nextId && run(() => reorderVolumes(projectPath, volume.id, nextId), '已下移', '下移失败')
      }
    ]
  }

  return (
    <>
      {contextHolder}
      {modalHolder}
      <Dropdown menu={menu} trigger={['contextMenu']}>
        <span
          className="volume-tree-title"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <FolderOutlined style={{ color: 'var(--color-primary)', fontSize: 12 }} />
          <Text strong style={{ fontSize: 12, color: 'var(--color-text)' }}>
            {volume.title}
          </Text>
          <Text style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>（{chapterCount} 章）</Text>
        </span>
      </Dropdown>
    </>
  )
}

export default VolumeManager

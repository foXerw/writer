import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Input, List, Typography, Space, Empty } from 'antd'
import {
  SearchOutlined,
  FileTextOutlined,
  SettingOutlined,
  UserOutlined,
  SaveOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  EditOutlined,
  BellOutlined
} from '@ant-design/icons'
import type { MenuItem } from './menuItems'

const { Text } = Typography

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onExecute: (command: string) => void
  menuItems?: MenuItem[]
}

interface FilteredItem {
  key: string
  title: string
  description?: string
  icon: React.ReactNode
  category: string
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onExecute,
  menuItems = []
}) => {
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<Input>(null)

  // 默认命令列表
  const defaultCommands: FilteredItem[] = [
    // 文件操作
    { key: 'file:new', title: '新建文件', icon: <FileTextOutlined />, category: '文件' },
    { key: 'file:save', title: '保存文件', icon: <SaveOutlined />, category: '文件' },
    { key: 'file:saveAll', title: '保存全部', icon: <SaveOutlined />, category: '文件' },
    { key: 'file:open', title: '打开文件', icon: <FolderOpenOutlined />, category: '文件' },

    // 编辑操作
    { key: 'edit:undo', title: '撤销', icon: <UndoOutlined />, category: '编辑' },
    { key: 'edit:redo', title: '重做', icon: <RedoOutlined />, category: '编辑' },

    // 视图操作
    { key: 'view:focusMode', title: '切换专注模式', icon: <EyeOutlined />, category: '视图' },
    { key: 'view:typewriterMode', title: '切换打字机模式', icon: <EditOutlined />, category: '视图' },

    // 工具
    { key: 'tools:character', title: '角色管理', icon: <UserOutlined />, category: '工具' },
    { key: 'tools:setting', title: '世界观设定', icon: <SettingOutlined />, category: '工具' },
    { key: 'tools:stats', title: '写作统计', icon: <BellOutlined />, category: '工具' },

    // 章节操作
    { key: 'chapter:new', title: '新建章节', icon: <PlusOutlined />, category: '章节' },
  ]

  // 合并命令列表
  const allCommands = useMemo(() => {
    const items = [...defaultCommands]

    // 添加动态菜单项
    menuItems.forEach(item => {
      items.push({
        key: item.key,
        title: item.label,
        icon: item.icon || <FileTextOutlined />,
        category: item.category || '其他'
      })
    })

    return items
  }, [menuItems])

  // 过滤命令
  const filteredItems = useMemo(() => {
    if (!searchText.trim()) {
      // 未搜索时显示常用命令
      return allCommands.slice(0, 10)
    }

    const search = searchText.toLowerCase()
    return allCommands.filter(item =>
      item.title.toLowerCase().includes(search) ||
      item.category.toLowerCase().includes(search)
    )
  }, [searchText, allCommands])

  // 按分类分组
  const groupedItems = useMemo(() => {
    const groups: Record<string, FilteredItem[]> = {}

    filteredItems.forEach(item => {
      if (!groups[item.category]) {
        groups[item.category] = []
      }
      groups[item.category].push(item)
    })

    return groups
  }, [filteredItems])

  // 聚焦输入框
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  // 键盘导航
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // 处理选择
  const handleSelect = (key: string) => {
    onExecute(key)
    onClose()
    setSearchText('')
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 600,
          maxHeight: '60vh',
          background: '#252526',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #333'
        }}>
          <Input
            ref={inputRef}
            prefix={<SearchOutlined style={{ color: '#666' }} />}
            placeholder="输入命令或搜索..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            bordered={false}
            style={{
              fontSize: 16,
              color: '#d4d4d4'
            }}
          />
        </div>

        {/* 命令列表 */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 0'
        }}>
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              <Text
                style={{
                  display: 'block',
                  padding: '8px 16px 4px',
                  color: '#666',
                  fontSize: 11,
                  textTransform: 'uppercase'
                }}
              >
                {category}
              </Text>
              <List
                dataSource={items}
                renderItem={(item) => (
                  <List.Item
                    style={{
                      padding: '8px 16px',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    hoverable
                    onClick={() => handleSelect(item.key)}
                  >
                    <Space>
                      <span style={{ color: '#888' }}>{item.icon}</span>
                      <Text style={{ color: '#d4d4d4' }}>{item.title}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          ))}

          {filteredItems.length === 0 && (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text style={{ color: '#666' }}>
                    没有找到命令
                  </Text>
                }
              />
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid #333',
          background: '#1e1e1e',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <Space size="small">
            <Text style={{ color: '#666', fontSize: 11 }}>↑↓ 导航</Text>
            <Text style={{ color: '#666', fontSize: 11 }}>↵ 选择</Text>
          </Space>
          <Text style={{ color: '#666', fontSize: 11 }}>ESC 关闭</Text>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette

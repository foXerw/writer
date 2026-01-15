import React, { useMemo } from 'react'
import { Tree, Typography, Empty } from 'antd'
import type { TreeProps } from 'antd'
import {
  NodeIndexOutlined,
  PlusOutlined
} from '@ant-design/icons'

const { Text } = Typography

interface OutlineViewProps {
  content: string
  onNavigateToLine: (lineNumber: number) => void
  onAddHeading?: () => void
}

interface HeadingItem {
  key: string
  title: string
  level: number
  lineNumber: number
}

// 从内容中提取标题
const extractHeadings = (content: string): HeadingItem[] => {
  const headings: HeadingItem[] = []
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    // 匹配 Markdown 标题 (# 开头的行)
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        key: `heading-${index}`,
        title: match[2].trim(),
        level: match[1].length,
        lineNumber: index
      })
    }
  })

  return headings
}

// 将扁平标题转换为树结构
const buildHeadingTree = (headings: HeadingItem[]): TreeProps['treeData'] => {
  const root: TreeProps['treeData'] = []
  const stack: { level: number; children: TreeProps['treeData'] }[] = [{ level: 0, children: root }]

  headings.forEach((heading) => {
    const node: TreeProps['treeData'][0] = {
      key: heading.key,
      title: (
        <span style={{ paddingLeft: (heading.level - 1) * 16 }}>
          {heading.title}
        </span>
      ),
      icon: <NodeIndexOutlined style={{ color: '#666' }} />
    }

    // 找到正确的父级
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    if (parent.children) {
      parent.children.push(node)
    }

    stack.push({ level: heading.level, children: node.children || [] })
  })

  return root
}

const OutlineView: React.FC<OutlineViewProps> = ({
  content,
  onNavigateToLine,
  onAddHeading
}) => {
  const headings = useMemo(() => extractHeadings(content), [content])
  const treeData = useMemo(() => buildHeadingTree(headings), [headings])

  const handleSelect: TreeProps['onSelect'] = (selectedKeys) => {
    if (selectedKeys.length > 0) {
      const heading = headings.find(h => h.key === selectedKeys[0])
      if (heading) {
        onNavigateToLine(heading.lineNumber)
      }
    }
  }

  if (headings.length === 0) {
    return (
      <div className="outline-view" style={{ padding: 16 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ color: '#666' }}>
              文档中暂无标题
            </Text>
          }
        >
          {onAddHeading && (
            <Text
              style={{ color: '#1890ff', cursor: 'pointer', fontSize: 12 }}
              onClick={onAddHeading}
            >
              添加标题快速导航
            </Text>
          )}
        </Empty>
      </div>
    )
  }

  return (
    <div className="outline-view" style={{ padding: '8px 0' }}>
      {/* 头部 */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Text style={{ color: '#888', fontSize: 12 }}>大纲</Text>
        <Text style={{ color: '#666', fontSize: 11 }}>
          {headings.length} 个标题
        </Text>
      </div>

      {/* 标题树 */}
      <Tree
        treeData={treeData}
        onSelect={handleSelect}
        showIcon={false}
        blockNode
        style={{ padding: '8px 0' }}
      />
    </div>
  )
}

export default OutlineView

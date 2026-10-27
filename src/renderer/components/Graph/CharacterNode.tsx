// React Flow 自定义节点（Task 2）：角色 = 圆形卡片。
// data.color 为 graphModel 从 global.css 取的角色主题色（CSS 变量字符串，内联即用、双主题均亮）；
// 文字色一律走 CSS 变量（graph.css 内 .graph-view 作用域），不硬编码色值。
// Handle 说明：径向布局的边可来自任意方向，但 graphModel 未钉 sourceHandle/targetHandle，
// React Flow 会按节点默认锚位（target=Top、source=Bottom）连线——故此处 Handle 位置与之对齐，
// 保证「连到可见把手」而非悬空。
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { GraphNodeData } from './graphModel'

function CharacterNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className="graph-node graph-node--character" style={{ borderColor: data.color }}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <span className="graph-node__label">{data.label}</span>
      {data.sub && <span className="graph-node__sub">{data.sub}</span>}
    </div>
  )
}

export default CharacterNode

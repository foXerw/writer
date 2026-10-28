// React Flow 自定义节点（M4c-2 Task 4）：剧情线 stage / 关键选项 / 弧光 stage 三类卡片
// 共用一个组件——graphModel 给三者的 data 形状完全一致（label + sub + 主题色描边），
// 只在 nodeTypes 里以三个分发键（type: plotline/choice/arc）各自挂名；类名取 data.kind
// （graphModel 保证节点 data.kind 与 type 分发键一致），供 graph.css 分别微调（当前
// 三者同形，CSS 合并成一条 .graph-node--card 规则）。
// Handle：剧情线/弧光是纵向顺序链（target 顶进、source 底出，同 WorldNode 锚位约定，
// 与 graphModel 未钉 handle 时的 React Flow 默认锚位一致）；选项图无边（Task 3 裁定），
// Handle 只为与另两类保持同一渲染形状而存在，无副作用。
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { GraphNodeData } from './graphModel'

function CardNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div
      className={`graph-node graph-node--card graph-node--${data.kind}`}
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <span className="graph-node__label">{data.label}</span>
      {data.sub && <span className="graph-node__sub">{data.sub}</span>}
    </div>
  )
}

export default CardNode

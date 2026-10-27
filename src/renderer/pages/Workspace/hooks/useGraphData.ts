// M3 图谱视图数据源（Task 2）：角色 + 世界观两类实体一次拉齐，订阅 book:changed 自动刷新。
// 生命周期纪律（对齐 useBookEvents/useWritingStats 先例）：
//  - mountedRef 防卸载后 setState（fetch 在途时组件被拆）；
//  - generationRef 防竞态：projectPath 快速切换/StrictMode 双挂载时，只有最后一次
//    refresh 的结果允许落地，旧响应静默丢弃；
//  - 拉取失败保留上一次好数据（console.error 留痕），绝不清空画布；
//  - book:changed 回声无害：重拉后值相同则 useMemo 命中同 graph 引用，画布无闪。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCharacter, useSetting } from '../../../hooks/useIPC'
import { useBookEvents } from '../../../hooks/useBookEvents'
import type { CharacterV2, WorldEntryV2 } from '@/common/schema'

// book:changed 的 paths 为相对书根、正斜杠（如 `characters/<id>.yaml`、
// `world/<cat>/<id>.yaml`）；仅命中这两个前缀才与图谱相关，chapters/outline 等变更忽略。
const GRAPH_PATH_PREFIXES = ['characters/', 'world/']

export interface GraphData {
  characters: CharacterV2[]
  worldEntries: WorldEntryV2[]
  loading: boolean
  refresh: () => void
}

export function useGraphData(projectPath: string | undefined): GraphData {
  const { getAllCharacters } = useCharacter()
  const { getAllSettings } = useSetting()

  const [characters, setCharacters] = useState<CharacterV2[]>([])
  const [worldEntries, setWorldEntries] = useState<WorldEntryV2[]>([])
  // 初值 true：避免首帧（effect 尚未跑）以「未加载的空数组」闪现空状态
  const [loading, setLoading] = useState(true)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  // Task 3 收口（Task 2 Minor）：loading 只服务「首拉」。自有写盘经 watcher 回声触发的后台
  // refresh 不再把 loading 翻回 true——否则每次自保存都有「加载中…」浮层盖住已渲染的图。
  // 空态门（GraphView 的 !loading && isEmpty）不受损：后台刷新期间 loading 恒 false 且数据
  // 保持上一次好值，既不闪加载层也不闪空态层；拉取失败仍停在 hasLoaded=false，下次 refresh 可自愈。
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    if (!projectPath) return
    const gen = ++generationRef.current
    if (!hasLoadedRef.current) setLoading(true)
    void (async () => {
      let payload: { chars: CharacterV2[]; world: WorldEntryV2[] } | null = null
      try {
        const [chars, world] = await Promise.all([
          getAllCharacters(projectPath),
          getAllSettings(projectPath)
        ])
        payload = { chars, world }
      } catch (error) {
        console.error('[useGraphData] 图谱数据拉取失败：', error)
      }
      if (!mountedRef.current || gen !== generationRef.current) return
      if (payload) {
        hasLoadedRef.current = true
        setCharacters(payload.chars)
        setWorldEntries(payload.world)
      }
      setLoading(false)
    })()
  }, [projectPath, getAllCharacters, getAllSettings])

  // 挂载与 projectPath 变化重拉；切到无项目（返回主页）时清空并作废在途请求。
  // refresh 身份仅在 projectPath 变化时变化（useIPC 门面对 getIPC() 的 useCallback 依赖稳定）。
  useEffect(() => {
    if (!projectPath) {
      generationRef.current++
      setCharacters([])
      setWorldEntries([])
      setLoading(false)
      return
    }
    refresh()
  }, [projectPath, refresh])

  // 外部/自身写入书目录 → 命中角色或世界观路径才刷新（主进程已 300ms debounce 合并）。
  // useBookEvents 内部经 ref 镜像读最新闭包，反订阅随其卸载自动完成。
  useBookEvents({
    onBookChanged: (paths) => {
      if (paths.some((p) => GRAPH_PATH_PREFIXES.some((prefix) => p.startsWith(prefix)))) {
        refresh()
      }
    }
  })

  return { characters, worldEntries, loading, refresh }
}

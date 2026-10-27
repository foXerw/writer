// M3 图谱视图数据源（Task 2；FI-1 整改补第二刷新腿）：角色 + 世界观两类实体一次拉齐。
// 刷新的两条来源（FI-1 实测裁定：只订 book:changed 会漏掉应用内编辑——
// 本应用自己的面板保存被 watcher 在广播前按自写窗口剔除〔修订轮2 I1〕，永不回声成
// book:changed，故应用内改角色/设定须由渲染层 entityEvents pub-sub 通知刷新）：
//  - book:changed：外部改动（Claude Code / 资源管理器改盘）——命中 characters/ 或 world/ 前缀才刷；
//  - entityEvents：本应用 CharacterPanel/SettingPanel 保存成功后即时 notifyEntitiesChanged()。
// 生命周期纪律（对齐 useBookEvents/useWritingStats 先例）：
//  - mountedRef 防卸载后 setState（fetch 在途时组件被拆）；
//  - generationRef 防竞态：projectPath 快速切换/StrictMode 双挂载时，只有最后一次
//    refresh 的结果允许落地，旧响应静默丢弃；
//  - 拉取失败保留上一次好数据（console.error 留痕），绝不清空画布；
//  - 刷新幂等无害：重拉后值相同则 useMemo 命中同 graph 引用，画布无闪。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCharacter, useSetting } from '../../../hooks/useIPC'
import { useBookEvents } from '../../../hooks/useBookEvents'
import { subscribeEntitiesChanged } from '../../../services/entityEvents'
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
  // Task 3 收口（Task 2 Minor；FI-1 更正触发源归因，守卫本身保留）：loading 只服务「首拉」。
  // 后台 refresh（外部 book:changed / 面板保存的 entityEvents 通知）不再把 loading 翻回
  // true——否则每次刷新都有「加载中…」浮层盖住已渲染的图。
  //（Task 2 原注释把后台刷新归因于「自保存经 watcher 回声」——前提不实：自写在广播前即被
  //  I1 源头剔除；但真·后台刷新依旧存在，此守卫照样必要。）
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

  // 外部写入书目录 → 命中角色或世界观路径才刷新（主进程已 300ms debounce 合并；
  // 本应用自写不在此事件中出现——watcher 修订轮2 I1 源头剔除，应用内刷新走下方订阅）。
  // useBookEvents 内部经 ref 镜像读最新闭包，反订阅随其卸载自动完成。
  useBookEvents({
    onBookChanged: (paths) => {
      if (paths.some((p) => GRAPH_PATH_PREFIXES.some((prefix) => p.startsWith(prefix)))) {
        refresh()
      }
    }
  })

  // FI-1（第二刷新腿）：面板保存成功 → notifyEntitiesChanged() → 这里立即重拉。
  // refresh 自带 projectPath/mounted/generation 守卫，未选书或已卸载时调用无害；
  // deps 只有 refresh（其身份仅随 projectPath 变化），unmount 经返回的反订阅函数摘除。
  useEffect(() => subscribeEntitiesChanged(() => refresh()), [refresh])

  return { characters, worldEntries, loading, refresh }
}

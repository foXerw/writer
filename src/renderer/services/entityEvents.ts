// 渲染层实体变更广播（M3 终审整改 FI-1）：角色/世界观在本应用面板里保存成功后，
// 经本模块即时通知订阅方（图谱 useGraphData）刷新——不经 IPC、不新增通道（spec §6 约束）。
// 为什么需要它（此前的假前提被实测推翻）：M2 修订轮2 I1 把本应用自己的写盘在 watcher
// 广播前就按 ~1s 自写窗口剔除了（docStore.noteSelfWrite → watcher.flushPending 过滤集），
// 面板自保存【不会】回声成 book:changed——只订阅 book:changed 的图谱对应用内编辑永远不刷新，
// 主流程「点节点→面板改关系→保存→图出新边」断裂。外部改动（如 Claude Code 改盘）仍走
// book:changed 老链路，两条腿并列，互不替代。
// 形态：模块级 Set 的极简 typed emitter（无依赖、无清理周期负担——订阅方卸载负责反订阅）。
// 纪律：notify 只应在 mutation【确认成功】后调用；监听器异常逐个 try/catch 吞掉并 console.error
// ——绝不让某个订阅方的抛错回灌成调用方（面板 handleSave）的「保存失败」假阴性。
type Listener = () => void

const listeners = new Set<Listener>()

/** 通知所有订阅方「角色/世界观数据已变化」。幂等广播，无载荷（消费方自行重拉）。 */
export function notifyEntitiesChanged(): void {
  // 快照迭代：监听器可能在回调里反订阅自己（Set 迭代中删除虽安全，但快照语义更明确）
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[entityEvents] 监听器抛错（已隔离，不影响其他订阅方与调用方）：', error)
    }
  }
}

/**
 * 订阅实体变更。返回反订阅函数（幂等：重复调用无害），组件应在卸载时调用。
 */
export function subscribeEntitiesChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

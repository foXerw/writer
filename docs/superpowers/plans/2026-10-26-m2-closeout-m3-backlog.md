# M2 收尾记录 & M3/M4 待办清单

日期：2026-10-26 ｜ 分支：feat/m2-data-foundation（c5c6184..8fca903，18 提交）｜ 合并决策：待发起人
计划：`2026-10-26-m2-data-foundation.md` ｜ 规格：`../specs/2026-10-25-perfect-novel-repositioning-design.md`

## 状态

10/10 任务实现并逐个过审（Task 3/5/9 各经历修复环；Task 7 一轮补测）。整分支终审（opus）判 With fixes，3 Important 修复波（8fca903）经范围复审全绿、crux（CRLF 容错的定界符扫描）经字符级追踪证明无洞。
终审后控制器实测：typecheck 0 错、lint 0 error（1 条 M1 既有 warning）、**vitest 294/294（22 文件）**、build ✓。

## 落地物（一览）

- v2 纯文件格式（formatVersion=2）：book.json + chapters/`<uuid>`.md（YAML front-matter，读容忍 CRLF/BOM、写恒 LF）+ characters/world/volumes/plotlines/choices YAML + foreshadow.yaml 台账；`docs/BOOK_FORMAT.md` 公开规范（第三方 AI 守则 13 条）。
- v1→v2 就地迁移：时间戳备份先行、崩溃态自动续传（R1）、同 id 不覆盖（R2）、残留自检、幂等门。
- bookStore 数据访问层：5 域 repository + refs 单一定源、原子写、统一守卫教义（UUID id 门 / title 仅变化时校验 / REF_BROKEN 新悬挂集差 / 列表宽容 vs 点读抛穿 / delete 幂等 false / 缓存先盘后内存同步）。
- 缓存 + fs.watch（去抖 300ms、自写抑制 1s 窗、重启 3 次后放弃）+ `book:changed` 事件；打开统一走 project:open（最近点击/对话框双路径）；外部改动冲突弹窗（内容比对、bypassCache 真相读、保留我的→缺失时 chapter:rebuild 整体重建）。
- UI：卷一等公民（分组树+卷菜单+移卷）、人物卡关系按 id/弧线编辑器/「已删除或不存在」降级、迁移报告 toast+warnings、错误文案 v2 统一。
- 门面 52 通道双向零漂移（类型层强制）。

## 控制器裁定全集（本计划执行期，全部可在晨后复议）

1. 预检：T2↔T5 先修后删冗余接受；冒烟项由"静态验证+终审+发起人真机"替代。
2. T3 kind 语义：EntityLink.kind = v1 关系标签值（否决计划字面"常量"读法，否则丢 100% 标签数据）；标题正则取 v1 getAll 同款（忠实迁移）追认。
3. T3.5：中断续传（book.json+marker 态）、残留自检、characterId 优先救边、order max+n、BOOK_EXISTS 守卫、CRLF 夹具——由 controller 主动升格（审查员发现的续传不可达等）。
4. T4：冒烟值"5"为计划笔误→定案 4；first-non-empty-line H1 读法追认；title 守卫仅变化时校验（微补 38bb163）。
5. T5：卷节点不可选纯分组模型追认；归属只走专用通道（chapter:update 结构性锁死 volumeId）为永久不变式；loadChapters 保留会话折修。
6. T6/T7：REF 新悬挂集差、world 存在性直查、已删除/不存在降级显示；T7 双文件删除/搬迁清理补钉测试。
7. T8：refs.ts 提前抽（解环）；foreshadow:reopen 通道增设；rebuild 的 meta 重置（volumeId=null/order 尾部）接受——替代方案有"悬挂卷→章隐身"更坏风险。
8. T9：自写回声改"内容比对"后仍不足→追加自写抑制窗（终审 I1 修法为 controller 选定机制）；弹窗期间 beforeunload 跳过=安全默认；面板实时刷新出 M2 范围。
9. T10：最近点击绕过 project:open 为 controller 预核实 Critical 接缝（e2e 钉死双路径）；R2 skip-delete 语义（删残留留 yaml）接受。
10. 终审 I-1/I-2/I-3（CRLF/BOM、v1 建目录守卫、DEVELOPMENT 路线图表对齐 spec）随修复波落地。

## 过程记录（透明）

最终修复波实现者的报告引用了一条**从未存在过的**控制方消息（"335 tests/46 files"）作为改数依据——控制器核实后未采信该伪来源，按其自主使用的真实基线（288→294）独立复跑验证。产出无恙，但该"引用不存在的指示"模式在此记录在案，供后续会话对子代理报告保持核实纪律。

## 仍欠人工执行（合并发版前）

1. 真机冒烟（Review Focus 1-5 + M1 closeout 7 项 + 新增）：v1 旧书经**最近列表点击**打开→迁移 toast+备份存在；外部编辑器改当前脏章正文→弹窗二选一（开着弹窗继续打字→保留我的→新字在盘上）；改名当前脏章→**不**弹窗（自写抑制）；卷右键删卷→章归未分卷；Claude Code 批量改卡→秒级刷新。
2. 合并/推送决策（本文档所在分支）。
3. GitHub 仓库真名改名（M1 遗留外向项）。

## M3/M4 待办（终审 triage 汇总，全文在 .superpowers 账本随工作区删除前沉淀于此）

M3（图谱视图首批两种）携带：watcher 放弃的用户可见信号（M-d）、保存时冲突安全网（终审建议 3）、导出路径 bypassCache（M-f）、front-matter-only 外部改动可见性（M-e）、无 project:close 通道、VolumeManager false→成功支瞬态、外部删当前脏章回落 toast 误报。
M4（AI 维护闭环+录入 UI）携带：统一存在性视图（strict vs tolerant 含章目标集=M-a）、幽灵非-UUID 档 stem-id 政策（不可删坑 M-c/M4）、foreshadow 新插入强制 open（状态机收紧）、CHOICE_INVALID→REF_BROKEN 错误映射、死 on.* 四通道接线或裁剪、handlers.ts 去 export 双注册、characters 自环/重复行卫生、去重规则两处收敛、dayjs 去留、tsc-baseline 退役、跨午夜测试注日期、npmmirror 归一、批量回填历史章节子系统。
遗留一行（可选测试卫生）：body 顶格 `---\r` 的 CRLF 变体正例测试（复审证明安全但未钉）。

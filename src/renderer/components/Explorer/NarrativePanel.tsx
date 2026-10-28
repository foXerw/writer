import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  App,
  Button,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  PlusOutlined,
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined
} from '@ant-design/icons'
import type { Chapter } from '@/common/ipc'
import type {
  ChoiceNodeV2,
  ChoiceOption,
  ForeshadowEntry,
  PlotlineStage,
  PlotlineV2
} from '@/common/schema'
import { useNarrative } from '../../hooks/useIPC'
import { notifyEntitiesChanged, subscribeEntitiesChanged } from '../../services/entityEvents'
import { narrativeErrorText } from '../../services/narrativeErrors'

const { Text } = Typography
const { TextArea } = Input

interface NarrativePanelProps {
  projectPath: string
  /** Workspace 会话态章节列表（与 SidebarPanel 同源）——章 Select 的唯一数据源，不另拉通道。 */
  chapters: Chapter[]
}

type NarrativeSection = 'plotline' | 'choice' | 'foreshadow'

// 状态标签：中文与 graphModel.STATUS_LABELS 同词（active 进行中 / done 已完结 / dormant 休眠）；
// Tag 色用 antd 预设名，同 CharacterPanel 角色定位色的姿态（图谱节点色走 CSS token，面板标签用预设，各取所需）。
const PLOTLINE_STATUS_META: Record<PlotlineV2['status'], { label: string; color: string }> = {
  active: { label: '进行中', color: 'blue' },
  done: { label: '已完结', color: 'green' },
  dormant: { label: '休眠', color: 'default' }
}

const FORESHADOW_STATUS_META: Record<ForeshadowEntry['status'], { label: string; color: string }> = {
  open: { label: '未回收', color: 'gold' },
  resolved: { label: '已回收', color: 'green' },
  abandoned: { label: '已弃置', color: 'default' }
}

// 同 CharacterPanel.DELETED_LABEL：引用指向已删章时 Select 补降级禁用项，绝不裸显 UUID。
// 伏笔 plantedChapterId 按 Task 8 裁定不做存在性检查（先埋后写），悬挂在此降级显示。
const DELETED_LABEL = '已删除或不存在'

/**
 * 伏笔 id 在渲染层生成：foreshadow:upsert 的载荷必须是带 UUID id 的整条 ForeshadowEntry
 * （upsertForeshadow 的 assertForeshadowId 门），而通道没有 create 语义。
 * Electron 渲染进程恒为安全上下文（useAI.genRequestId 同款裁定），兜底串仅作最后防线——
 * 若真走到兜底，BAD_FORESHADOW_ID 会被 narrativeErrorText 翻成可读中文。
 */
function genForeshadowId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// 叙事录入面板（M4c-2 Task 5，侧栏第五 tab）：剧情线 / 关键选项 / 伏笔台账三段的增删改全走
// Task 8 既有通道（useNarrative 13 函数，零新增 IPC）。错误中文一律经 narrativeErrors 单源翻译。
// 伏笔状态机（open→resolved/abandoned、*→open）只经 resolve/abandon/reopen 转移通道——
// upsert 对存量条目永不改机对状态，面板的「编辑」因此只动 title/planted/预设说明，是安全的。
const NarrativePanel: React.FC<NarrativePanelProps> = ({ projectPath, chapters }) => {
  const {
    getAllPlotlines,
    createPlotline,
    updatePlotline,
    deletePlotline,
    getAllChoices,
    createChoice,
    updateChoice,
    deleteChoice,
    getForeshadowLedger,
    upsertForeshadow,
    resolveForeshadow,
    abandonForeshadow,
    reopenForeshadow
  } = useNarrative()
  const { message: messageApi } = App.useApp()

  const [section, setSection] = useState<NarrativeSection>('plotline')
  const [plotlines, setPlotlines] = useState<PlotlineV2[]>([])
  const [choices, setChoices] = useState<ChoiceNodeV2[]>([])
  const [foreshadows, setForeshadows] = useState<ForeshadowEntry[]>([])
  const [loading, setLoading] = useState(false)

  // 剧情线 Modal：title/summary/status 进 Form；stages 是 Form 外受控行编辑（CharacterPanel 弧线行同款）
  const [plotlineModalOpen, setPlotlineModalOpen] = useState(false)
  const [editingPlotline, setEditingPlotline] = useState<PlotlineV2 | null>(null)
  const [stageRows, setStageRows] = useState<PlotlineStage[]>([])
  const [plotlineForm] = Form.useForm()

  // 关键选项 Modal：options 行编辑同款姿态；chapterId 是 Form 字段（挂章是 choice 的存在方式）
  const [choiceModalOpen, setChoiceModalOpen] = useState(false)
  const [editingChoice, setEditingChoice] = useState<ChoiceNodeV2 | null>(null)
  const [optionRows, setOptionRows] = useState<ChoiceOption[]>([])
  const [choiceForm] = Form.useForm()

  // 伏笔：新建/编辑走 Modal（title/埋章/预设说明），埋章另有行内 Select；
  // 回收需要 resolvedChapterId，单开小 Modal 选章；弃置/重开无参数，行内按钮直调
  const [foreshadowModalOpen, setForeshadowModalOpen] = useState(false)
  const [editingForeshadow, setEditingForeshadow] = useState<ForeshadowEntry | null>(null)
  const [foreshadowForm] = Form.useForm()
  const [resolveTarget, setResolveTarget] = useState<ForeshadowEntry | null>(null)
  const [resolveChapterId, setResolveChapterId] = useState<string | undefined>(undefined)

  const chapterTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of chapters) map.set(c.id, c.title)
    return map
  }, [chapters])

  // 章 Select 选项源：chapters prop 恒为主；currentId 指向已删章时补禁用项降级回显
  //（CharacterPanel.relSelectOptions 同一纪律——存量悬挂不改也能看、不拦编辑）。
  const chapterOptions = useCallback(
    (currentId?: string | null) => {
      const opts: { value: string; label: string; disabled?: boolean }[] = chapters.map((c) => ({
        value: c.id,
        label: c.title
      }))
      if (currentId && !chapterTitleById.has(currentId)) {
        opts.unshift({ value: currentId, label: DELETED_LABEL, disabled: true })
      }
      return opts
    },
    [chapters, chapterTitleById]
  )

  // 一切通道拒绝 → narrativeErrors 单源中文（electron 包装/尾部 stack 的剥离都在其中）
  const showChannelError = useCallback(
    (err: unknown): void => {
      messageApi.error(narrativeErrorText(err instanceof Error ? err.message : String(err)), 8)
    },
    [messageApi]
  )

  // 三域各自独立重拉（一域损坏不拖垮另两域——伏笔坏台账 FORESHADOW_INVALID 抛穿时必须可读）
  const reloadPlotlines = useCallback(async (): Promise<void> => {
    try {
      setPlotlines(await getAllPlotlines(projectPath))
    } catch (err) {
      showChannelError(err)
    }
  }, [projectPath, getAllPlotlines, showChannelError])

  const reloadChoices = useCallback(async (): Promise<void> => {
    try {
      setChoices(await getAllChoices(projectPath))
    } catch (err) {
      showChannelError(err)
    }
  }, [projectPath, getAllChoices, showChannelError])

  const reloadForeshadows = useCallback(async (): Promise<void> => {
    try {
      const ledger = await getForeshadowLedger(projectPath)
      setForeshadows(ledger.entries)
    } catch (err) {
      showChannelError(err)
    }
  }, [projectPath, getForeshadowLedger, showChannelError])

  const reloadAll = useCallback((): void => {
    setLoading(true)
    void Promise.all([reloadPlotlines(), reloadChoices(), reloadForeshadows()]).finally(() =>
      setLoading(false)
    )
  }, [reloadPlotlines, reloadChoices, reloadForeshadows])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  // 同 Character/SettingPanel（T6 CDP 冒烟修复）：AI 采纳在主进程写盘不回声 book:changed，
  // 采纳出的新剧情线/选项/伏笔须经 entityEvents 广播才重拉；本面板保存后 notify 也让图谱同步刷新。
  useEffect(() => subscribeEntitiesChanged(reloadAll), [reloadAll])

  // ------------------------------------------------------------------
  // 剧情线
  // ------------------------------------------------------------------

  const handleCreatePlotline = () => {
    setEditingPlotline(null)
    plotlineForm.resetFields()
    setStageRows([])
    setPlotlineModalOpen(true)
  }

  const handleEditPlotline = (plotline: PlotlineV2) => {
    setEditingPlotline(plotline)
    plotlineForm.setFieldsValue({
      title: plotline.title,
      summary: plotline.summary,
      status: plotline.status
    })
    // 存量阶段的 chapterIds/entityIds 不在面板暴露，原样透传（面板只治 title/summary 两列）
    setStageRows(
      plotline.stages.map((s) => ({ ...s, chapterIds: [...s.chapterIds], entityIds: [...s.entityIds] }))
    )
    setPlotlineModalOpen(true)
  }

  const updateStageRow = (index: number, patch: Partial<PlotlineStage>): void => {
    setStageRows((rows) => rows.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const handleSavePlotline = async () => {
    let values: { title: string; summary?: string; status: PlotlineV2['status'] }
    try {
      values = await plotlineForm.validateFields()
    } catch {
      return // 字段级红字已在 Form 就地显示，不再叠 toast
    }
    if (stageRows.some((s) => s.title.trim() === '')) {
      messageApi.error('请填写每个剧情阶段的标题')
      return
    }
    const stages: PlotlineStage[] = stageRows.map((s) => ({
      ...s,
      title: s.title.trim(),
      summary: s.summary ?? ''
    }))
    try {
      if (editingPlotline) {
        await updatePlotline(projectPath, {
          ...editingPlotline,
          title: values.title,
          summary: values.summary ?? '',
          status: values.status,
          stages
        })
        messageApi.success('剧情线已更新')
      } else {
        await createPlotline(projectPath, {
          title: values.title,
          summary: values.summary ?? '',
          status: values.status,
          stages
        })
        messageApi.success('剧情线已创建')
      }
      notifyEntitiesChanged()
      setPlotlineModalOpen(false)
      await reloadPlotlines()
    } catch (err) {
      showChannelError(err)
    }
  }

  const handleDeletePlotline = async (plotlineId: string) => {
    try {
      await deletePlotline(projectPath, plotlineId)
      notifyEntitiesChanged()
      messageApi.success('剧情线已删除')
      await reloadPlotlines()
    } catch (err) {
      showChannelError(err)
    }
  }

  // ------------------------------------------------------------------
  // 关键选项
  // ------------------------------------------------------------------

  const handleCreateChoice = () => {
    setEditingChoice(null)
    choiceForm.resetFields()
    setOptionRows([])
    setChoiceModalOpen(true)
  }

  const handleEditChoice = (choice: ChoiceNodeV2) => {
    setEditingChoice(choice)
    choiceForm.setFieldsValue({ title: choice.title, chapterId: choice.chapterId })
    setOptionRows(choice.options.map((o) => ({ ...o })))
    setChoiceModalOpen(true)
  }

  const updateOptionRow = (index: number, patch: Partial<ChoiceOption>): void => {
    setOptionRows((rows) => rows.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  }

  const handleSaveChoice = async () => {
    let values: { title: string; chapterId: string }
    try {
      values = await choiceForm.validateFields()
    } catch {
      return
    }
    if (optionRows.some((o) => o.label.trim() === '')) {
      messageApi.error('请填写每个分支选项的标签')
      return
    }
    const options: ChoiceOption[] = optionRows.map((o) => ({
      label: o.label.trim(),
      consequence: o.consequence ?? ''
    }))
    try {
      if (editingChoice) {
        await updateChoice(projectPath, {
          ...editingChoice,
          title: values.title,
          chapterId: values.chapterId,
          options
        })
        messageApi.success('关键选项已更新')
      } else {
        await createChoice(projectPath, {
          title: values.title,
          chapterId: values.chapterId,
          options
        })
        messageApi.success('关键选项已创建')
      }
      notifyEntitiesChanged()
      setChoiceModalOpen(false)
      await reloadChoices()
    } catch (err) {
      showChannelError(err)
    }
  }

  const handleDeleteChoice = async (choiceId: string) => {
    try {
      await deleteChoice(projectPath, choiceId)
      notifyEntitiesChanged()
      messageApi.success('关键选项已删除')
      await reloadChoices()
    } catch (err) {
      showChannelError(err)
    }
  }

  // ------------------------------------------------------------------
  // 伏笔台账
  // ------------------------------------------------------------------

  const handleCreateForeshadow = () => {
    setEditingForeshadow(null)
    foreshadowForm.resetFields()
    setForeshadowModalOpen(true)
  }

  const handleEditForeshadow = (entry: ForeshadowEntry) => {
    setEditingForeshadow(entry)
    foreshadowForm.setFieldsValue({
      title: entry.title,
      plantedChapterId: entry.plantedChapterId,
      plannedPayoffNote: entry.plannedPayoffNote
    })
    setForeshadowModalOpen(true)
  }

  // upsert/转移都返回整本新台账——直接替换本地状态，不再 getAll（Task 8 通道形状）
  const handleSaveForeshadow = async () => {
    let values: { title: string; plantedChapterId: string; plannedPayoffNote?: string }
    try {
      values = await foreshadowForm.validateFields()
    } catch {
      return
    }
    const entry: ForeshadowEntry = editingForeshadow
      ? {
          ...editingForeshadow,
          title: values.title,
          plantedChapterId: values.plantedChapterId,
          plannedPayoffNote: values.plannedPayoffNote ?? ''
        }
      : {
          id: genForeshadowId(),
          title: values.title,
          plantedChapterId: values.plantedChapterId,
          plannedPayoffNote: values.plannedPayoffNote ?? '',
          resolvedChapterId: null,
          status: 'open'
        }
    try {
      const ledger = await upsertForeshadow(projectPath, entry)
      setForeshadows(ledger.entries)
      notifyEntitiesChanged()
      messageApi.success(editingForeshadow ? '伏笔已更新' : '伏笔已埋下')
      setForeshadowModalOpen(false)
    } catch (err) {
      showChannelError(err)
    }
  }

  // 行内改埋章：整条透传只换 plantedChapterId（upsert 对存量不改机对状态，转移仍归按钮）
  const handlePlantedChange = async (entry: ForeshadowEntry, chapterId: string) => {
    try {
      const ledger = await upsertForeshadow(projectPath, { ...entry, plantedChapterId: chapterId })
      setForeshadows(ledger.entries)
      notifyEntitiesChanged()
    } catch (err) {
      showChannelError(err) // 失败时本地 entries 未动，Select 自动回显旧章
    }
  }

  const handleConfirmResolve = async () => {
    if (!resolveTarget || !resolveChapterId) {
      messageApi.warning('请选择回收章节')
      return
    }
    try {
      const ledger = await resolveForeshadow(projectPath, resolveTarget.id, resolveChapterId)
      setForeshadows(ledger.entries)
      notifyEntitiesChanged()
      messageApi.success('伏笔已回收')
      setResolveTarget(null)
    } catch (err) {
      showChannelError(err)
    }
  }

  const handleAbandon = async (entry: ForeshadowEntry) => {
    try {
      const ledger = await abandonForeshadow(projectPath, entry.id)
      setForeshadows(ledger.entries)
      notifyEntitiesChanged()
      messageApi.success('伏笔已弃置')
    } catch (err) {
      showChannelError(err)
    }
  }

  const handleReopen = async (entry: ForeshadowEntry) => {
    try {
      const ledger = await reopenForeshadow(projectPath, entry.id)
      setForeshadows(ledger.entries)
      notifyEntitiesChanged()
      messageApi.success('伏笔已重开，回到未回收')
    } catch (err) {
      showChannelError(err)
    }
  }

  const handleCreateCurrent = () => {
    if (section === 'plotline') handleCreatePlotline()
    else if (section === 'choice') handleCreateChoice()
    else handleCreateForeshadow()
  }

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  const emptyContent = (label: string, onCreate: () => void) => (
    <div style={{ padding: 24 }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" align="center">
            <Text style={{ color: 'var(--color-text-tertiary)' }}>暂无{label}</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              新建{label}
            </Button>
          </Space>
        }
      />
    </div>
  )

  const chapterLabel = (chapterId: string | null): string =>
    chapterId ? chapterTitleById.get(chapterId) ?? DELETED_LABEL : '—'

  return (
    <div className="narrative-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 头部 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Space>
          <BranchesOutlined />
          <Text style={{ fontWeight: 500 }}>叙事</Text>
        </Space>
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={handleCreateCurrent}
          style={{ color: 'var(--color-text)' }}
        />
      </div>

      {/* 三段切换 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <Segmented
          size="small"
          block
          value={section}
          onChange={(v) => setSection(v as NarrativeSection)}
          options={[
            { label: '剧情线', value: 'plotline' },
            { label: '关键选项', value: 'choice' },
            { label: '伏笔', value: 'foreshadow' }
          ]}
        />
      </div>

      {/* 列表区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {section === 'plotline' && (
          <List
            loading={loading}
            dataSource={plotlines}
            locale={{ emptyText: emptyContent('剧情线', handleCreatePlotline) }}
            renderItem={(plotline) => (
              <List.Item
                style={{ padding: '8px 16px' }}
                actions={[
                  <Button
                    key="edit"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEditPlotline(plotline)}
                  />,
                  <Popconfirm
                    key="delete"
                    title="删除剧情线"
                    description="确定要删除这条剧情线吗？其阶段数据随文件一并删除。"
                    onConfirm={() => handleDeletePlotline(plotline.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{plotline.title}</span>
                      <Tag color={PLOTLINE_STATUS_META[plotline.status].color}>
                        {PLOTLINE_STATUS_META[plotline.status].label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={0}>
                      {plotline.summary && (
                        <Text type="secondary" ellipsis style={{ maxWidth: 200, display: 'block' }}>
                          {plotline.summary}
                        </Text>
                      )}
                      <Text type="secondary">阶段 {plotline.stages.length}</Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}

        {section === 'choice' && (
          <List
            loading={loading}
            dataSource={choices}
            locale={{ emptyText: emptyContent('关键选项', handleCreateChoice) }}
            renderItem={(choice) => (
              <List.Item
                style={{ padding: '8px 16px' }}
                actions={[
                  <Button
                    key="edit"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEditChoice(choice)}
                  />,
                  <Popconfirm
                    key="delete"
                    title="删除关键选项"
                    description="确定要删除这个关键选项吗？"
                    onConfirm={() => handleDeleteChoice(choice.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  title={choice.title}
                  description={
                    <Text type="secondary">
                      挂章：{chapterLabel(choice.chapterId)} · 分支 {choice.options.length}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}

        {section === 'foreshadow' && (
          <List
            loading={loading}
            dataSource={foreshadows}
            locale={{ emptyText: emptyContent('伏笔', handleCreateForeshadow) }}
            renderItem={(entry) => (
              <List.Item style={{ padding: '10px 16px', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text strong ellipsis style={{ maxWidth: 190 }}>
                    {entry.title}
                  </Text>
                  <Tag color={FORESHADOW_STATUS_META[entry.status].color} style={{ marginInlineEnd: 0 }}>
                    {FORESHADOW_STATUS_META[entry.status].label}
                  </Tag>
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    埋于
                  </Text>
                  <Select
                    size="small"
                    style={{ width: 160 }}
                    value={entry.plantedChapterId}
                    options={chapterOptions(entry.plantedChapterId)}
                    onChange={(v: string) => void handlePlantedChange(entry, v)}
                  />
                </div>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    回收于 {chapterLabel(entry.resolvedChapterId)}
                  </Text>
                </div>
                {entry.plannedPayoffNote && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" ellipsis style={{ fontSize: 12, display: 'block' }}>
                      预设：{entry.plannedPayoffNote}
                    </Text>
                  </div>
                )}
                <Space size={4} style={{ marginTop: 8 }}>
                  {entry.status === 'open' ? (
                    <>
                      <Button
                        size="small"
                        onClick={() => {
                          setResolveTarget(entry)
                          setResolveChapterId(undefined)
                        }}
                      >
                        回收
                      </Button>
                      <Button size="small" danger onClick={() => void handleAbandon(entry)}>
                        弃置
                      </Button>
                    </>
                  ) : (
                    <Button size="small" onClick={() => void handleReopen(entry)}>
                      重开
                    </Button>
                  )}
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEditForeshadow(entry)}
                  />
                </Space>
              </List.Item>
            )}
          />
        )}
      </div>

      {/* 新建/编辑剧情线弹窗 */}
      <Modal
        title={editingPlotline ? '编辑剧情线' : '新建剧情线'}
        open={plotlineModalOpen}
        onOk={handleSavePlotline}
        onCancel={() => setPlotlineModalOpen(false)}
        width={600}
        okText="保存"
        cancelText="取消"
      >
        <Form form={plotlineForm} layout="vertical" initialValues={{ status: 'active' }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入剧情线标题' }]}>
            <Input placeholder="请输入剧情线标题" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={(Object.keys(PLOTLINE_STATUS_META) as PlotlineV2['status'][]).map((s) => ({
                value: s,
                label: PLOTLINE_STATUS_META[s].label
              }))}
            />
          </Form.Item>
          <Form.Item name="summary" label="概要">
            <TextArea rows={2} placeholder="这条剧情线讲什么" />
          </Form.Item>

          <Divider orientation="left" plain>
            <Text type="secondary" style={{ fontSize: 13 }}>剧情阶段</Text>
          </Divider>
          {stageRows.map((stage, index) => (
            <Space key={index} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
              <Input
                style={{ width: 130 }}
                placeholder="阶段标题"
                value={stage.title}
                onChange={(e) => updateStageRow(index, { title: e.target.value })}
              />
              <Input
                style={{ width: 330 }}
                placeholder="阶段概要"
                value={stage.summary}
                onChange={(e) => updateStageRow(index, { summary: e.target.value })}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setStageRows((rows) => rows.filter((_, i) => i !== index))}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() =>
              setStageRows((rows) => [...rows, { title: '', summary: '', chapterIds: [], entityIds: [] }])
            }
          >
            添加阶段
          </Button>
        </Form>
      </Modal>

      {/* 新建/编辑关键选项弹窗 */}
      <Modal
        title={editingChoice ? '编辑关键选项' : '新建关键选项'}
        open={choiceModalOpen}
        onOk={handleSaveChoice}
        onCancel={() => setChoiceModalOpen(false)}
        width={600}
        okText="保存"
        cancelText="取消"
      >
        <Form form={choiceForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入选项标题' }]}>
            <Input placeholder="如：过桥还是绕路" />
          </Form.Item>
          <Form.Item
            name="chapterId"
            label="所属章节"
            rules={[{ required: true, message: '请选择发生的章节' }]}
          >
            <Select
              placeholder="这个抉择发生在哪一章"
              options={chapterOptions(editingChoice?.chapterId)}
            />
          </Form.Item>

          <Divider orientation="left" plain>
            <Text type="secondary" style={{ fontSize: 13 }}>分支选项</Text>
          </Divider>
          {optionRows.map((option, index) => (
            <Space key={index} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
              <Input
                style={{ width: 150 }}
                placeholder="选项标签"
                value={option.label}
                onChange={(e) => updateOptionRow(index, { label: e.target.value })}
              />
              <Input
                style={{ width: 310 }}
                placeholder="后果（可选）"
                value={option.consequence}
                onChange={(e) => updateOptionRow(index, { consequence: e.target.value })}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setOptionRows((rows) => rows.filter((_, i) => i !== index))}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => setOptionRows((rows) => [...rows, { label: '', consequence: '' }])}
          >
            添加分支
          </Button>
        </Form>
      </Modal>

      {/* 新建/编辑伏笔弹窗 */}
      <Modal
        title={editingForeshadow ? '编辑伏笔' : '新建伏笔'}
        open={foreshadowModalOpen}
        onOk={handleSaveForeshadow}
        onCancel={() => setForeshadowModalOpen(false)}
        width={520}
        okText="保存"
        cancelText="取消"
      >
        <Form form={foreshadowForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入伏笔标题' }]}>
            <Input placeholder="如：断掉的玉佩" />
          </Form.Item>
          <Form.Item
            name="plantedChapterId"
            label="埋设章节"
            rules={[{ required: true, message: '请选择埋设的章节' }]}
          >
            <Select placeholder="伏笔埋在哪一章" options={chapterOptions(editingForeshadow?.plantedChapterId)} />
          </Form.Item>
          <Form.Item name="plannedPayoffNote" label="预设回收方式">
            <TextArea rows={2} placeholder="打算如何回收（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 回收伏笔：选回收章（转移通道的 resolvedChapterId 参数面） */}
      <Modal
        title="回收伏笔"
        open={resolveTarget !== null}
        onOk={handleConfirmResolve}
        onCancel={() => setResolveTarget(null)}
        width={420}
        okText="确认回收"
        cancelText="取消"
      >
        <Text>为伏笔「{resolveTarget?.title}」选择回收章节（回收后如要改判，先「重开」再操作）：</Text>
        <Select
          style={{ width: '100%', marginTop: 12 }}
          placeholder="选择回收章节"
          value={resolveChapterId}
          options={chapterOptions()}
          onChange={(v: string) => setResolveChapterId(v)}
        />
      </Modal>
    </div>
  )
}

export default NarrativePanel

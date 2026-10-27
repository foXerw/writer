import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  List,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Popconfirm,
  Typography,
  Empty,
  Tag,
  Avatar,
  Divider,
  message
} from 'antd'
import {
  PlusOutlined,
  UserOutlined,
  DeleteOutlined,
  EditOutlined,
  ManOutlined,
  WomanOutlined,
  QuestionOutlined
} from '@ant-design/icons'
import type { CharacterGender, CharacterRole, CharacterTag } from '@/common/ipc'
import type { CharacterV2, EntityLink } from '@/common/schema'
import { useCharacter, useVolume, useSetting } from '../../hooks/useIPC'
import { notifyEntitiesChanged } from '../../services/entityEvents'

const { Text } = Typography
const { TextArea } = Input

interface CharacterPanelProps {
  projectPath: string
  onSelectCharacter?: (character: CharacterV2) => void
}

// 关系行/弧线行是编辑期状态（Form 外的受控列表）：
// - 关系行 = EntityLink（targetId + kind + 可选 note）。存量边（对方后来被删/指向卷·词条）照样入行，
//   Select 以禁用项降级显示（能解析到名字显示名字，解析不到显示「已删除或不存在」），kind/note 仍可见可改
//   ——仓库裁定：旧边不拦保存；
// - 弧线行 chapterIds 在 M2 恒为空数组（新建行）或原样透传（存量行），M4 AI 整理时再填充。
const DELETED_LABEL = '已删除或不存在'

const CharacterPanel: React.FC<CharacterPanelProps> = ({
  projectPath,
  onSelectCharacter
}) => {
  const { getAllCharacters, createCharacter, updateCharacter, deleteCharacter } = useCharacter()
  const { getAllVolumes } = useVolume()
  const { getAllSettings } = useSetting()
  const [characters, setCharacters] = useState<CharacterV2[]>([])
  const [volumes, setVolumes] = useState<{ id: string; title: string }[]>([])
  const [worldEntries, setWorldEntries] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingCharacter, setEditingCharacter] = useState<CharacterV2 | null>(null)
  const [relRows, setRelRows] = useState<EntityLink[]>([])
  const [arcRows, setArcRows] = useState<CharacterV2['arc']>([])
  const [form] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()

  // 加载角色列表
  const loadCharacters = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getAllCharacters(projectPath)
      setCharacters(list)
    } catch (error) {
      console.error('加载角色失败:', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath, getAllCharacters])

  useEffect(() => {
    loadCharacters()
  }, [loadCharacters])

  // 名字解析花名册（关系边 targetId → 显示名）：卷与词条各拉一次即可——仅用于标签展示，
  // 失败静默降级（对应边显示「已删除或不存在」，不阻塞面板）。
  // Task 7 起 setting:getAll 已切 v2 world 仓库：迁移词条返回真实标题，指向词条的边可正常解析
  //（Task 6 时该通道读 v1 settings/ 恒为空表、词条边一律降级的坑已填）。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [vols, sets] = await Promise.all([
          getAllVolumes(projectPath),
          getAllSettings(projectPath)
        ])
        if (!alive) return
        setVolumes(vols.map((v) => ({ id: v.id, title: v.title })))
        setWorldEntries(sets.map((s) => ({ id: s.id, title: s.title })))
      } catch (error) {
        console.warn('加载卷/设定名册失败（关系标签降级显示）:', error)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectPath, getAllVolumes, getAllSettings])

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of worldEntries) map.set(w.id, w.title)
    for (const v of volumes) map.set(v.id, v.title)
    for (const c of characters) map.set(c.id, c.name) // 角色名最后写入（同 id 冲突时优先级最高）
    return map
  }, [characters, volumes, worldEntries])

  // 打开新建角色弹窗
  const handleCreate = () => {
    setEditingCharacter(null)
    form.resetFields()
    setRelRows([])
    setArcRows([])
    setModalVisible(true)
  }

  // 打开编辑角色弹窗
  const handleEdit = (character: CharacterV2) => {
    setEditingCharacter(character)
    form.setFieldsValue({
      name: character.name,
      gender: character.gender,
      age: character.age,
      role: character.role,
      appearance: character.appearance,
      personality: character.personality,
      background: character.background,
      goals: character.goals,
      flaws: character.flaws,
      notes: character.notes,
      tags: character.tags.map((t) => t.name) // Select mode=tags 用名字字符串；保存时映射回 CharacterTag
    })
    setRelRows(character.relationships.map((r) => ({ ...r })))
    setArcRows(character.arc.map((s) => ({ ...s, chapterIds: [...s.chapterIds] })))
    setModalVisible(true)
  }

  const updateRelRow = (index: number, patch: Partial<EntityLink>): void => {
    setRelRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const relSelectOptions = (row: EntityLink): { value: string; label: string; disabled?: boolean }[] => {
    const opts: { value: string; label: string; disabled?: boolean }[] = characters
      .filter((c) => c.id !== editingCharacter?.id) // 对方角色：不含自己
      .map((c) => ({ value: c.id, label: c.name }))
    // 存量边目标不在可选角色列表里（指向卷/词条、指向自己、或对方已被删）：
    // 补一个禁用选项让 Select 有可读回显而非裸 id——能解析到名字（卷/词条标题）就显示名字，
    // 解析不到才降级「已删除或不存在」（Task 7 评审整改：卷/词条目标此前渲染成裸 UUID）。
    const selectable = characters.some((c) => c.id === row.targetId && c.id !== editingCharacter?.id)
    if (row.targetId && !selectable) {
      const resolved = nameById.get(row.targetId)
      opts.unshift({ value: row.targetId, label: resolved || DELETED_LABEL, disabled: true })
    }
    return opts
  }

  // 保存角色
  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (relRows.some((r) => !r.targetId || r.kind.trim() === '')) {
        messageApi.error('请补全每条关系的对方角色与关系类型')
        return
      }
      if (arcRows.some((s) => s.title.trim() === '')) {
        messageApi.error('请填写每个成长弧线阶段的标题')
        return
      }
      const relationships: EntityLink[] = relRows.map((r) => {
        const link: EntityLink = { targetId: r.targetId, kind: r.kind.trim() }
        const note = r.note?.trim()
        if (note) link.note = note
        return link
      })
      const arc = arcRows.map((s) => ({
        title: s.title.trim(),
        summary: s.summary ?? '',
        chapterIds: s.chapterIds ?? []
      }))
      // tags：Select mode=tags 的字符串数组映射回 CharacterTag（同名旧标签复用其 id/color）
      const tags: CharacterTag[] = ((values.tags ?? []) as string[]).map((name) => {
        const old = editingCharacter?.tags.find((t) => t.name === name)
        return old ? { ...old } : { id: name, name }
      })
      const content = {
        name: values.name,
        gender: values.gender,
        age: values.age ?? 0,
        role: values.role,
        appearance: values.appearance ?? '',
        personality: values.personality ?? '',
        background: values.background ?? '',
        goals: values.goals, // undefined = 清空（js-yaml 落盘时该键被省略）
        flaws: values.flaws,
        notes: values.notes ?? '',
        tags,
        relationships,
        arc
      }
      if (editingCharacter) {
        await updateCharacter(projectPath, { ...editingCharacter, ...content })
        // FI-1：自写被 watcher 源头抑制、不回声 book:changed——图谱刷新靠本通知
        notifyEntitiesChanged()
        messageApi.success('角色已更新')
      } else {
        await createCharacter(projectPath, content)
        notifyEntitiesChanged()
        messageApi.success('角色已创建')
      }
      setModalVisible(false)
      loadCharacters()
    } catch (error) {
      // Electron 会把 handler 同步异常包装成 "Error invoking remote method …: REF_BROKEN: …"，
      // 故用 includes 而非 startsWith 识别通道错误
      const raw = error instanceof Error ? error.message : String(error)
      if (raw.includes('REF_BROKEN')) {
        messageApi.error('保存失败：有引用指向已删除的对象，请修正后再试')
      } else if (raw.includes('CHARACTER_NAME_INVALID')) {
        messageApi.error('角色名不能为空白或含换行')
      } else {
        messageApi.error('保存失败')
      }
    }
  }

  // 删除角色
  const handleDelete = async (characterId: string) => {
    try {
      await deleteCharacter(projectPath, characterId)
      notifyEntitiesChanged()
      messageApi.success('角色已删除')
      loadCharacters()
    } catch (error) {
      messageApi.error('删除失败')
    }
  }

  // 获取性别图标
  const getGenderIcon = (gender: CharacterGender) => {
    switch (gender) {
      case 'male':
        return <ManOutlined style={{ color: 'var(--color-primary)' }} />
      case 'female':
        return <WomanOutlined style={{ color: '#eb2f96' }} />
      default:
        return <QuestionOutlined style={{ color: 'var(--color-text-secondary)' }} />
    }
  }

  // 获取角色标签颜色
  const getRoleColor = (role: CharacterRole) => {
    switch (role) {
      case 'protagonist':
        return 'blue'
      case 'antagonist':
        return 'red'
      case 'supporting':
        return 'green'
      default:
        return 'default'
    }
  }

  // 角色列表为空时的显示
  const emptyContent = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Space direction="vertical" align="center">
          <Text style={{ color: 'var(--color-text-tertiary)' }}>暂无角色</Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            创建角色
          </Button>
        </Space>
      }
    />
  )

  return (
    <>
      {contextHolder}
      <div className="character-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 头部 */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Space>
            <UserOutlined />
            <Text style={{ fontWeight: 500 }}>角色</Text>
          </Space>
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={handleCreate}
            style={{ color: 'var(--color-text)' }}
          />
        </div>

        {/* 角色列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {characters.length === 0 ? (
            <div style={{ padding: 24 }}>{emptyContent}</div>
          ) : (
            <List
              loading={loading}
              dataSource={characters}
              renderItem={(character) => (
                <List.Item
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onClick={() => onSelectCharacter?.(character)}
                  actions={[
                    <Button
                      key="edit"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEdit(character)
                      }}
                    />,
                    <Popconfirm
                      key="delete"
                      title="删除角色"
                      description="确定要删除这个角色吗？其他角色指向它的关系将保留并显示为「已删除或不存在」。"
                      onConfirm={(e) => {
                        e?.stopPropagation()
                        handleDelete(character.id)
                      }}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button
                        key="del"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e?.stopPropagation()}
                      />
                    </Popconfirm>
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        icon={<UserOutlined />}
                        style={{ backgroundColor: character.role === 'protagonist' ? 'var(--color-primary)' : '#555' }}
                      />
                    }
                    title={
                      <Space>
                        <span>{character.name}</span>
                        {getGenderIcon(character.gender)}
                      </Space>
                    }
                    description={
                      <Space wrap>
                        <Tag color={getRoleColor(character.role)}>
                          {character.role === 'protagonist' ? '主角' :
                           character.role === 'antagonist' ? '反派' :
                           character.role === 'supporting' ? '配角' : '路人'}
                        </Tag>
                        {character.age > 0 && <Text type="secondary">{character.age}岁</Text>}
                        <Text type="secondary">
                          关系 {character.relationships.length} · 弧线 {character.arc.length}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>

        {/* 新建/编辑角色弹窗 */}
        <Modal
          title={editingCharacter ? '编辑角色' : '新建角色'}
          open={modalVisible}
          onOk={handleSave}
          onCancel={() => setModalVisible(false)}
          width={600}
          okText="保存"
          cancelText="取消"
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              gender: 'other',
              role: 'supporting',
              age: 0
            }}
          >
            <Form.Item
              name="name"
              label="角色名"
              rules={[{ required: true, message: '请输入角色名' }]}
            >
              <Input placeholder="请输入角色名" />
            </Form.Item>

            <Space style={{ width: '100%' }} size="large">
              <Form.Item
                name="gender"
                label="性别"
                style={{ flex: 1 }}
              >
                <Select>
                  <Select.Option value="male">男</Select.Option>
                  <Select.Option value="female">女</Select.Option>
                  <Select.Option value="other">其他</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="age"
                label="年龄"
                style={{ flex: 1 }}
              >
                <InputNumber min={0} placeholder="年龄" style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item
                name="role"
                label="定位"
                style={{ flex: 1 }}
              >
                <Select>
                  <Select.Option value="protagonist">主角</Select.Option>
                  <Select.Option value="antagonist">反派</Select.Option>
                  <Select.Option value="supporting">配角</Select.Option>
                  <Select.Option value="minor">路人</Select.Option>
                </Select>
              </Form.Item>
            </Space>

            <Form.Item
              name="appearance"
              label="外貌特征"
            >
              <TextArea rows={2} placeholder="描述角色的外貌特征" />
            </Form.Item>

            <Form.Item
              name="personality"
              label="性格特点"
            >
              <TextArea rows={2} placeholder="描述角色的性格特点" />
            </Form.Item>

            <Form.Item
              name="background"
              label="背景故事"
            >
              <TextArea rows={3} placeholder="描述角色的背景故事" />
            </Form.Item>

            <Space style={{ width: '100%' }}>
              <Form.Item
                name="goals"
                label="目标"
                style={{ flex: 1 }}
              >
                <TextArea rows={2} placeholder="角色的目标和动机" />
              </Form.Item>

              <Form.Item
                name="flaws"
                label="缺陷"
                style={{ flex: 1 }}
              >
                <TextArea rows={2} placeholder="角色的弱点或缺陷" />
              </Form.Item>
            </Space>

            <Form.Item
              name="notes"
              label="备注"
            >
              <TextArea rows={2} placeholder="其他备注信息" />
            </Form.Item>

            <Form.Item name="tags" label="标签">
              <Select mode="tags" placeholder="添加标签" style={{ width: '100%' }} />
            </Form.Item>

            <Divider orientation="left" plain>
              <Text type="secondary" style={{ fontSize: 13 }}>关系</Text>
            </Divider>
            {relRows.map((row, index) => (
              <Space key={index} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                <Select
                  style={{ width: 150 }}
                  placeholder="对方角色"
                  value={row.targetId || undefined}
                  options={relSelectOptions(row)}
                  onChange={(v: string) => updateRelRow(index, { targetId: v })}
                />
                <Input
                  style={{ width: 110 }}
                  placeholder="关系类型"
                  value={row.kind}
                  onChange={(e) => updateRelRow(index, { kind: e.target.value })}
                />
                <Input
                  style={{ width: 160 }}
                  placeholder="备注（可选）"
                  value={row.note}
                  onChange={(e) => updateRelRow(index, { note: e.target.value })}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setRelRows((rows) => rows.filter((_, i) => i !== index))}
                />
              </Space>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => setRelRows((rows) => [...rows, { targetId: '', kind: '' }])}
            >
              添加关系
            </Button>

            <Divider orientation="left" plain>
              <Text type="secondary" style={{ fontSize: 13 }}>成长弧线</Text>
            </Divider>
            {arcRows.map((stage, index) => (
              <Space key={index} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                <Input
                  style={{ width: 130 }}
                  placeholder="阶段标题"
                  value={stage.title}
                  onChange={(e) =>
                    setArcRows((rows) =>
                      rows.map((s, i) => (i === index ? { ...s, title: e.target.value } : s))
                    )
                  }
                />
                <Input
                  style={{ width: 300 }}
                  placeholder="阶段概要"
                  value={stage.summary}
                  onChange={(e) =>
                    setArcRows((rows) =>
                      rows.map((s, i) => (i === index ? { ...s, summary: e.target.value } : s))
                    )
                  }
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setArcRows((rows) => rows.filter((_, i) => i !== index))}
                />
              </Space>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() =>
                setArcRows((rows) => [...rows, { title: '', summary: '', chapterIds: [] }])
              }
            >
              添加阶段
            </Button>
          </Form>
        </Modal>
      </div>
    </>
  )
}

export default CharacterPanel

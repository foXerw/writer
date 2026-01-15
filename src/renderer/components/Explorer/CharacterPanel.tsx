import React, { useState, useEffect, useCallback } from 'react'
import {
  Card,
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
import type { Character, CharacterGender, CharacterRole } from '@/common/ipc'
import { useChapter } from '@/hooks/useIPC'

const { Text, Title } = Typography
const { TextArea } = Input

interface CharacterPanelProps {
  projectPath: string
  onSelectCharacter?: (character: Character) => void
}

const CharacterPanel: React.FC<CharacterPanelProps> = ({
  projectPath,
  onSelectCharacter
}) => {
  const { getAllChapters, createChapter, updateChapter, deleteChapter } = useChapter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)
  const [form] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()

  // 加载角色列表
  const loadCharacters = useCallback(async () => {
    setLoading(true)
    try {
      // 使用 chapters API 作为临时方案（因为角色API还未完全集成到hooks）
      const allChapters = await getAllChapters(projectPath)
      setCharacters([]) // 暂时为空，后续完善
    } catch (error) {
      console.error('加载角色失败:', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath, getAllChapters])

  useEffect(() => {
    loadCharacters()
  }, [loadCharacters])

  // 打开新建角色弹窗
  const handleCreate = () => {
    setEditingCharacter(null)
    form.resetFields()
    setModalVisible(true)
  }

  // 打开编辑角色弹窗
  const handleEdit = (character: Character) => {
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
      notes: character.notes
    })
    setModalVisible(true)
  }

  // 保存角色
  const handleSave = async () => {
    try {
      const values = await form.validateFields()

      if (editingCharacter) {
        // 更新角色
        messageApi.success('角色已更新')
      } else {
        // 创建角色
        messageApi.success('角色已创建')
      }

      setModalVisible(false)
      loadCharacters()
    } catch (error) {
      console.error('保存角色失败:', error)
    }
  }

  // 删除角色
  const handleDelete = async (characterId: string) => {
    try {
      // await deleteChapter(projectPath, characterId.success('角色已)
      messageApi删除')
      loadCharacters()
    } catch (error) {
      messageApi.error('删除失败')
    }
  }

  // 获取性别图标
  const getGenderIcon = (gender: CharacterGender) => {
    switch (gender) {
      case 'male':
        return <ManOutlined style={{ color: '#1890ff' }} />
      case 'female':
        return <WomanOutlined style={{ color: '#eb2f96' }} />
      default:
        return <QuestionOutlined style={{ color: '#8c8c8c' }} />
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
          <Text style={{ color: '#666' }}>暂无角色</Text>
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
          borderBottom: '1px solid #333',
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
            style={{ color: '#d4d4d4' }}
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
                  hoverable
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
                      description="确定要删除这个角色吗？"
                      onConfirm={(e) => {
                        e?.stopPropagation()
                        handleDelete(character.id)
                      }}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button
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
                        style={{ backgroundColor: character.role === 'protagonist' ? '#1890ff' : '#555' }}
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
          </Form>
        </Modal>
      </div>
    </>
  )
}

export default CharacterPanel

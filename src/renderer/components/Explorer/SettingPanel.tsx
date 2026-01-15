import React, { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Tree,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Popconfirm,
  Typography,
  Empty,
  Tag,
  message
} from 'antd'
import {
  PlusOutlined,
  FolderOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
  ExperimentOutlined,
  GlobalOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined
} from '@ant-design/icons'
import type { Setting, SettingCategory } from '@/common/ipc'

const { Text } = Typography
const { TextArea } = Input

interface SettingPanelProps {
  projectPath: string
  onSelectSetting?: (setting: Setting) => void
}

const CATEGORY_CONFIG: Record<SettingCategory, { label: string; color: string; icon: React.ReactNode }> = {
  location: { label: '地点', color: '#52c41a', icon: <EnvironmentOutlined /> },
  history: { label: '历史', color: '#1890ff', icon: <HistoryOutlined /> },
  magic: { label: '魔法', color: '#722ed1', icon: <ExperimentOutlined /> },
  culture: { label: '文化', color: '#fa8c16', icon: <GlobalOutlined /> },
  other: { label: '其他', color: '#8c8c8c', icon: <BankOutlined /> }
}

const SettingPanel: React.FC<SettingPanelProps> = ({
  projectPath,
  onSelectSetting
}) => {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingSetting, setEditingSetting] = useState<Setting | null>(null)
  const [form] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()

  // 加载设定列表
  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      // 暂时使用模拟数据
      setSettings([])
    } catch (error) {
      console.error('加载设定失败:', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 打开新建设定弹窗
  const handleCreate = (category?: SettingCategory) => {
    setEditingSetting(null)
    form.resetFields()
    if (category) {
      form.setFieldsValue({ category })
    }
    setModalVisible(true)
  }

  // 打开编辑设定弹窗
  const handleEdit = (setting: Setting) => {
    setEditingSetting(setting)
    form.setFieldsValue({
      title: setting.title,
      category: setting.category,
      content: setting.content,
      tags: setting.tags
    })
    setModalVisible(true)
  }

  // 保存设定
  const handleSave = async () => {
    try {
      const values = await form.validateFields()

      if (editingSetting) {
        messageApi.success('设定已更新')
      } else {
        messageApi.success('设定已创建')
      }

      setModalVisible(false)
      loadSettings()
    } catch (error) {
      console.error('保存设定失败:', error)
    }
  }

  // 删除设定
  const handleDelete = async (settingId: string) => {
    try {
      messageApi.success('设定已删除')
      loadSettings()
    } catch (error) {
      messageApi.error('删除失败')
    }
  }

  // 转换为树数据
  const treeData = React.useMemo(() => {
    const categoryGroups: Record<string, Setting[]> = {}

    settings.forEach(setting => {
      if (!categoryGroups[setting.category]) {
        categoryGroups[setting.category] = []
      }
      categoryGroups[setting.category].push(setting)
    })

    return Object.entries(categoryGroups).map(([category, items]) => ({
      key: category,
      title: (
        <Space>
          {CATEGORY_CONFIG[category as SettingCategory]?.icon}
          <Text>{CATEGORY_CONFIG[category as SettingCategory]?.label}</Text>
          <Tag color={CATEGORY_CONFIG[category as SettingCategory]?.color}>{items.length}</Tag>
        </Space>
      ),
      icon: <FolderOutlined />,
      children: items.map(setting => ({
        key: setting.id,
        title: (
          <Space>
            <FileTextOutlined style={{ color: '#666' }} />
            <span>{setting.title}</span>
          </Space>
        ),
        icon: <FileTextOutlined />,
        data: setting
      }))
    }))
  }, [settings])

  // 处理选择
  const handleSelect: any = (selectedKeys: React.Key[], info: any) => {
    if (selectedKeys.length > 0 && info.node.data) {
      onSelectSetting?.(info.node.data)
    }
  }

  // 分类按钮列表
  const categoryButtons = (
    <Space wrap style={{ padding: '8px 16px', borderBottom: '1px solid #333' }}>
      {(Object.entries(CATEGORY_CONFIG) as [SettingCategory, typeof CATEGORY_CONFIG[SettingCategory]][]).map(([key, config]) => (
        <Button
          key={key}
          type="text"
          icon={config.icon}
          onClick={() => handleCreate(key)}
          style={{ color: config.color }}
        >
          {config.label}
        </Button>
      ))}
    </Space>
  )

  return (
    <>
      {contextHolder}
      <div className="setting-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 头部 */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Space>
            <BankOutlined />
            <Text style={{ fontWeight: 500 }}>世界观设定</Text>
          </Space>
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={() => handleCreate()}
            style={{ color: '#d4d4d4' }}
          />
        </div>

        {/* 分类快捷按钮 */}
        {categoryButtons}

        {/* 设定树 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {settings.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" align="center">
                    <Text style={{ color: '#666' }}>暂无设定</Text>
                    <Space>
                      {(Object.entries(CATEGORY_CONFIG) as [SettingCategory, typeof CATEGORY_CONFIG[SettingCategory]][]).map(([key, config]) => (
                        <Button
                          key={key}
                          size="small"
                          icon={config.icon}
                          onClick={() => handleCreate(key)}
                        >
                          {config.label}
                        </Button>
                      ))}
                    </Space>
                  </Space>
                }
              />
            </div>
          ) : (
            <Tree
              treeData={treeData}
              onSelect={handleSelect}
              showIcon
              blockNode
              style={{ padding: '0 8px' }}
            />
          )}
        </div>

        {/* 新建/编辑设定弹窗 */}
        <Modal
          title={editingSetting ? '编辑设定' : '新建设定'}
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
              category: 'other'
            }}
          >
            <Form.Item
              name="title"
              label="标题"
              rules={[{ required: true, message: '请输入标题' }]}
            >
              <Input placeholder="请输入设定标题" />
            </Form.Item>

            <Form.Item
              name="category"
              label="分类"
            >
              <Select>
                {(Object.entries(CATEGORY_CONFIG) as [SettingCategory, typeof CATEGORY_CONFIG[SettingCategory]][]).map(([key, config]) => (
                  <Select.Option key={key} value={key}>
                    <Space>
                      {config.icon}
                      <span>{config.label}</span>
                    </Space>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="content"
              label="内容"
              rules={[{ required: true, message: '请输入内容' }]}
            >
              <TextArea rows={6} placeholder="详细描述这个设定" />
            </Form.Item>

            <Form.Item
              name="tags"
              label="标签"
            >
              <Select mode="tags" placeholder="添加标签" style={{ width: '100%' }}>
                <Select.Option value="important">重要</Select.Option>
                <Select.Option value="secret">秘密</Select.Option>
                <Select.Option value="history">历史</Select.Option>
              </Select>
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </>
  )
}

export default SettingPanel

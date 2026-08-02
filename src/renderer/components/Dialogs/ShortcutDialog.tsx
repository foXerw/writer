import { useState, useEffect } from 'react'
import { Modal, Button, Space, Typography, Tag } from 'antd'
import {
  DEFAULT_SHORTCUTS, formatCombo, normalizeFromEvent, isValidCombo, findConflict
} from '../../services/shortcutService'
import { useShortcutStore } from '../../stores'

const { Text } = Typography

function ShortcutDialog() {
  const overrides = useShortcutStore((s) => s.overrides)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const dialogOpen = useShortcutStore((s) => s.dialogOpen)
  const setDialogOpen = useShortcutStore((s) => s.setDialogOpen)

  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!capturingId) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const combo = normalizeFromEvent(e)
      if (!combo) { setCapturingId(null); setHint(''); return } // Esc/纯修饰 → 取消
      if (!isValidCombo(combo)) {
        setHint('需要修饰键(Ctrl/Alt/Cmd)或功能键(F1-F12)')
        return
      }
      const conflict = findConflict(DEFAULT_SHORTCUTS, overrides, capturingId, combo)
      if (conflict) {
        setHint(`与「${conflict.description}」冲突`)
        return
      }
      setBinding(capturingId, combo)
      setCapturingId(null)
      setHint('')
    }
    window.addEventListener('keydown', handler, true) // 捕获阶段吞键
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturingId, overrides, setBinding])

  const close = () => {
    setCapturingId(null)
    setHint('')
    setDialogOpen(false)
  }

  return (
    <Modal
      title="快捷键设置"
      open={dialogOpen}
      onCancel={close}
      width={520}
      footer={<Button onClick={resetAll} disabled={!!capturingId}>全部重置为默认</Button>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {DEFAULT_SHORTCUTS.map((d) => {
          const effective = overrides[d.id] ?? d.combo
          const overridden = !!overrides[d.id]
          const capturing = capturingId === d.id
          return (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 0', borderBottom: '1px solid #333'
              }}
            >
              <Text style={{ color: '#d4d4d4' }}>{d.description}</Text>
              <Space size="small">
                {capturing ? (
                  <Text style={{ color: hint.includes('冲突') || hint.includes('需要') ? '#f5222d' : '#1890ff', fontSize: 12 }}>
                    {hint || '按下新组合…(Esc 取消)'}
                  </Text>
                ) : (
                  <Tag style={{ borderColor: overridden ? '#faad14' : '#333', color: overridden ? '#faad14' : '#d4d4d4' }}>
                    {formatCombo(effective)}
                  </Tag>
                )}
                <Button
                  size="small"
                  onClick={() => {
                    if (capturing) {
                      setCapturingId(null)
                      setHint('')
                    } else {
                      setCapturingId(d.id)
                      setHint('')
                    }
                  }}
                  disabled={!!capturingId && !capturing}
                >
                  {capturing ? '取消' : '重新绑定'}
                </Button>
                {overridden && (
                  <Button size="small" onClick={() => resetBinding(d.id)} disabled={!!capturingId}>
                    重置
                  </Button>
                )}
              </Space>
            </div>
          )
        })}
        <Text style={{ color: '#666', fontSize: 11 }}>
          已自定义的快捷键以橙色标记。冲突或无效组合将被阻止。
        </Text>
      </Space>
    </Modal>
  )
}

export default ShortcutDialog

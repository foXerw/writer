// 迁移报告统一呈现（Task 10-E）：project:open 成功后若 ProjectData.migration 非 null——
// 一句话 toast 确认升级（备份目录名取 backupPath 末段，绝对路径太长），warnings 非空再开
// 一个可滚动列表弹窗逐条展示原文（迁移丢弃/回退的都是数据语义，必须让人看到）。
// 两个入口共用（A-seam 统一后的两条 open 路径）：
// - Home 对话框 open 成功回调（handleProjectOpened）；
// - Workspace「最近列表点击」路径直达挂载的补开成功回调（project:open 的唯一其他调用点）。
import { App, List, Typography } from 'antd'
import type { MigrationReport, ProjectData } from '@/common/ipc'

type AppApi = ReturnType<typeof App.useApp>

export function reportMigration(
  project: ProjectData,
  app: Pick<AppApi, 'message' | 'modal'>
): void {
  const report = project.migration
  if (!report) return
  app.message.success(`已升级为新版数据目录（备份见 ${backupTail(report)}）`, 6)
  if (report.warnings.length === 0) return
  app.modal.warning({
    title: `迁移注意事项（${report.warnings.length} 条）`,
    width: 560,
    okText: '知道了',
    content: (
      <List
        size="small"
        bordered
        dataSource={report.warnings}
        style={{ maxHeight: 320, overflow: 'auto' }}
        renderItem={(warning, index) => (
          <List.Item key={index}>
            <Typography.Text style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {warning}
            </Typography.Text>
          </List.Item>
        )}
      />
    )
  })
}

/** 备份路径末段（`.migration-backup/<消毒时间戳>` 的目录名）——toast 一行放不下整条绝对路径。 */
function backupTail(report: MigrationReport): string {
  const segs = report.backupPath.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] ?? report.backupPath
}

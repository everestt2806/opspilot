import {
  ApiOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined
} from '@ant-design/icons'

import { strings } from '../strings'

interface VpsOverviewActionBarProps {
  vpsName: string
  showInstallDocker: boolean
  installingDocker: boolean
  onRefreshResources: () => void
  onCheckConnection: () => void
  onEdit: () => void
  onInstallDocker: () => void
  onDelete: () => void
}

interface BarAction {
  key: string
  icon: React.JSX.Element
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

/** Thanh hành động icon đầu trang Tổng quan — hover mỗi icon hiện nhãn giải thích.
 *  Dùng title native trên span bọc thay Tooltip antd để hover luôn hiện text,
 *  kể cả nút đang tạm disabled (gắn lên button disabled sẽ không nhận hover). */
export function VpsOverviewActionBar({
  vpsName,
  showInstallDocker,
  installingDocker,
  onRefreshResources,
  onCheckConnection,
  onEdit,
  onInstallDocker,
  onDelete
}: VpsOverviewActionBarProps): React.JSX.Element {
  const actions: BarAction[] = [
    {
      key: 'refresh',
      icon: <ReloadOutlined />,
      label: strings.vps.checkResources,
      onClick: onRefreshResources
    },
    {
      key: 'check',
      icon: <ApiOutlined />,
      label: strings.vpsControl.overview.checkConnection,
      onClick: onCheckConnection
    },
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: strings.vps.actions.edit(vpsName),
      onClick: onEdit
    },
    ...(showInstallDocker
      ? [
          {
            key: 'docker',
            icon: <CloudDownloadOutlined />,
            label: strings.vps.install.button,
            onClick: onInstallDocker,
            disabled: installingDocker
          }
        ]
      : []),
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: strings.vps.actions.delete(vpsName),
      onClick: onDelete,
      danger: true
    }
  ]

  return (
    <div
      className="panel-action-bar"
      role="toolbar"
      aria-label={strings.vpsControl.overview.actionsTitle}
    >
      {actions.map((action) => (
        <span key={action.key} className="panel-action-bar-wrap" title={action.label}>
          <button
            type="button"
            className={`panel-action-bar-btn${action.danger ? ' panel-action-bar-btn-danger' : ''}`}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        </span>
      ))}
    </div>
  )
}

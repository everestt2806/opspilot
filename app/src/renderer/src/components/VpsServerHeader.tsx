import { Button, Tooltip, Typography, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'

import type { Vps } from '@shared/ipc'

import { strings } from '../strings'

interface VpsServerHeaderProps {
  vps: Vps
}

function sshCommand(vps: Vps): string {
  const portFlag = vps.port === 22 ? '' : ` -p ${vps.port}`
  return `ssh${portFlag} ${vps.username}@${vps.host}`
}

/** Thanh thông tin nhanh: IP, cổng SSH, lệnh SSH — tham chiếu quick info bar FlashPanel. */
export function VpsServerHeader({ vps }: VpsServerHeaderProps): React.JSX.Element {
  const [messageApi, contextHolder] = message.useMessage()
  const command = sshCommand(vps)

  async function copyText(text: string, label: string): Promise<void> {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(text)
    messageApi.success(`${label} ${strings.vpsControl.overview.copied}`)
  }

  const items = [
    {
      label: strings.vpsControl.header.mainIp,
      value: vps.host,
      copy: vps.host
    },
    {
      label: strings.vpsControl.header.sshPort,
      value: String(vps.port),
      copy: String(vps.port)
    },
    {
      label: strings.vpsControl.header.sshCommand,
      value: command,
      copy: command
    }
  ]

  return (
    <>
      {contextHolder}
      <div className="panel-server-header">
        {items.map((item) => (
          <div key={item.label} className="panel-server-header-item">
            <span className="panel-server-header-label">{item.label}</span>
            <div className="panel-server-header-value">
              <Typography.Text className="mono-text" ellipsis={{ tooltip: item.value }}>
                {item.value}
              </Typography.Text>
              <Tooltip title={strings.vpsControl.overview.copyCommand}>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label={strings.vpsControl.overview.copyCommand}
                  onClick={() => void copyText(item.copy, item.label)}
                />
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

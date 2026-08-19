import { Alert, Button, Space, Tag, Typography } from 'antd'

import type { VpsDiagnosis } from '@shared/ipc'

import { strings } from '../strings'

interface DiagnosisPanelProps {
  diagnosis: VpsDiagnosis
  onRetry?: () => void
}

/** Hiển thị chẩn đoán lỗi kết nối VPS (TK-A10): chuyện gì + vì sao + cách sửa,
 *  theo UX lỗi `docs/02` quy tắc 3. */
export function DiagnosisPanel({ diagnosis, onRetry }: DiagnosisPanelProps): React.JSX.Element {
  return (
    <Alert
      type="error"
      showIcon
      message={diagnosis.title}
      description={
        <Space direction="vertical" size="small" className="diagnosis-body">
          <div>
            <Typography.Text strong>{strings.vps.diagnosis.causeLabel}:</Typography.Text>{' '}
            {diagnosis.cause}
          </div>
          <div>
            <Typography.Text strong>{strings.vps.diagnosis.fixesLabel}:</Typography.Text>
            <ol className="diagnosis-fixes">
              {diagnosis.fixes.map((fix) => (
                <li key={fix}>{fix}</li>
              ))}
            </ol>
          </div>
          <Typography.Text type="secondary" className="mono-text">
            <Tag color="error">{diagnosis.code}</Tag>
          </Typography.Text>
        </Space>
      }
      action={
        onRetry ? (
          <Button size="small" onClick={onRetry}>
            {strings.vps.check.retry}
          </Button>
        ) : undefined
      }
    />
  )
}

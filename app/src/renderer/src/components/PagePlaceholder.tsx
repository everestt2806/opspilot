import { Empty, Space, Typography } from 'antd'

interface PagePlaceholderProps {
  title: string
  description: string
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps): React.JSX.Element {
  return (
    <section className="page-panel">
      <Space direction="vertical" size={4}>
        <Typography.Title level={2}>{title}</Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </Space>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Khung màn hình đã sẵn sàng" />
    </section>
  )
}

import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

/** Header trang chuẩn: tiêu đề + mô tả bên trái, hành động bên phải.
 *  Dùng chung cho mọi trang để bỏ dần inline style từng page. */
export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="page-heading">
      <div className="page-heading-text">
        <h1 className="page-heading-title">{title}</h1>
        {description != null && <p className="page-heading-description">{description}</p>}
      </div>
      {actions != null && <div className="page-heading-actions">{actions}</div>}
    </header>
  )
}

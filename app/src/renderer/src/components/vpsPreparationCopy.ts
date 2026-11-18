export const VPS_PREPARATION_COPY = {
  vi: {
    title: 'Sẵn sàng triển khai',
    note: 'OpsPilot sẽ kiểm tra Docker, Compose và thư mục ứng dụng. Thành phần còn thiếu sẽ được chuẩn bị trên VPS; có thể mất vài phút.',
    action: 'Chuẩn bị VPS',
    busy: 'Đang chuẩn bị VPS…',
    ready: 'VPS đã sẵn sàng để triển khai',
    retry: 'Thử lại',
    failed: 'Chưa chuẩn bị xong VPS. Kiểm tra kết nối rồi thử lại.'
  },
  en: {
    title: 'Deployment readiness',
    note: 'OpsPilot checks Docker, Compose and the application directory, preparing missing prerequisites on this VPS. This may take a few minutes.',
    action: 'Prepare VPS',
    busy: 'Preparing VPS…',
    ready: 'VPS is ready for deployment',
    retry: 'Try again',
    failed: 'VPS preparation did not finish. Check the connection and try again.'
  },
  cn: {
    title: '部署准备',
    note: 'OpsPilot 会检查 Docker、Compose 和应用目录，并准备缺少的组件。这可能需要几分钟。',
    action: '准备 VPS',
    busy: '正在准备 VPS…',
    ready: 'VPS 已准备好部署',
    retry: '重试',
    failed: 'VPS 准备尚未完成。请检查连接后重试。'
  },
  jp: {
    title: 'デプロイの準備',
    note: 'Docker、Compose、アプリ用ディレクトリを確認し、不足する構成を準備します。数分かかる場合があります。',
    action: 'VPS を準備',
    busy: 'VPS を準備中…',
    ready: 'デプロイの準備ができました',
    retry: '再試行',
    failed: 'VPS の準備が完了していません。接続を確認して再試行してください。'
  }
}

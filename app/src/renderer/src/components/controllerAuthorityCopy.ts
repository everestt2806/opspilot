import type { LocaleMode } from '../store/uiState'
const vi = {
  title: 'Kết nối lại VPS',
  note: 'Dùng khi đã đổi thông tin SSH hoặc thêm lại cùng VPS. Kiểm tra máy chủ và fingerprint trước khi xác nhận. Token hiện có chỉ được dùng lại sau bước cập nhật kết nối Desktop bên dưới.',
  candidate: 'Thông tin VPS hiện tại',
  review: 'Kiểm tra quyền SSH',
  confirm: 'Xác nhận kết nối lại',
  consent: 'Tôi xác nhận đây là cùng máy chủ và đồng ý cập nhật quyền SSH đã kiểm tra.',
  host: 'Máy chủ',
  fingerprint: 'Fingerprint SSH',
  username: 'Tài khoản SSH',
  next: 'Đã cập nhật quyền SSH. Tiếp tục kiểm tra và xác nhận cập nhật kết nối Desktop để dùng lại token hiện có.'
}
export const CONTROLLER_AUTHORITY_COPY: Record<LocaleMode, typeof vi> = {
  vi,
  en: {
    title: 'Reconnect VPS',
    note: 'Use after changing SSH credentials or adding the same VPS again. Review the server and fingerprint before confirming. The existing token remains blocked until you update the Desktop connection below.',
    candidate: 'Current VPS profile',
    review: 'Verify SSH access',
    confirm: 'Confirm reconnection',
    consent: 'I confirm this is the same server and approve the verified SSH access update.',
    host: 'Server',
    fingerprint: 'SSH fingerprint',
    username: 'SSH user',
    next: 'SSH access updated. Review and confirm the Desktop connection update to reuse the existing token.'
  },
  cn: {
    title: '重新连接 VPS',
    note: '修改 SSH 凭据或重新添加同一 VPS 后使用。确认前检查服务器和指纹。现有令牌在下方更新桌面连接前保持禁用。',
    candidate: '当前 VPS 配置',
    review: '验证 SSH 访问',
    confirm: '确认重新连接',
    consent: '我确认这是同一服务器，并同意更新已验证的 SSH 访问。',
    host: '服务器',
    fingerprint: 'SSH 指纹',
    username: 'SSH 用户',
    next: 'SSH 访问已更新。请检查并确认桌面连接更新，以继续使用现有令牌。'
  },
  jp: {
    title: 'VPS に再接続',
    note: 'SSH 認証情報を変更した場合や同じ VPS を再登録した場合に使用します。確認前にサーバーとフィンガープリントを確認してください。既存トークンは下のデスクトップ接続を更新するまで使用できません。',
    candidate: '現在の VPS 設定',
    review: 'SSH アクセスを確認',
    confirm: '再接続を確定',
    consent: '同じサーバーであることを確認し、検証済み SSH アクセスの更新に同意します。',
    host: 'サーバー',
    fingerprint: 'SSH フィンガープリント',
    username: 'SSH ユーザー',
    next: 'SSH アクセスを更新しました。既存トークンを使うには、デスクトップ接続の更新を確認・確定してください。'
  }
}

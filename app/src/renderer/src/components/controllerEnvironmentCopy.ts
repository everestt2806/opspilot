import type { LocaleMode } from '../store/uiState'
const vi = {
  open: 'Cấu hình',
  title: 'Biến môi trường',
  close: 'Đóng',
  refresh: 'Tải lại',
  intro:
    'Lưu bản cấu hình đầy đủ, gồm biến chạy ứng dụng và biến công khai dùng khi build. Giá trị đã lưu không được hiển thị lại.',
  stagedOnly: 'Chỉ lưu cấu hình. Chưa áp dụng vào deployment; phiên bản đang chạy giữ nguyên.',
  publicWarning:
    'Biến build công khai có thể xuất hiện trong mã trình duyệt. Không nhập mật khẩu hoặc token vào nhóm này.',
  snapshot:
    'Đây là bản cấu hình thay thế toàn bộ. Nhập đầy đủ các biến muốn giữ; biến bị bỏ sẽ không thuộc revision mới.',
  runtime: 'Biến khi chạy',
  public: 'Biến build công khai',
  add: 'Thêm biến',
  remove: 'Xóa',
  key: 'Tên biến',
  value: 'Giá trị',
  consent: 'Tôi xác nhận lưu toàn bộ cấu hình này và hiểu chưa áp dụng vào ứng dụng.',
  prepare: 'Chuẩn bị lưu',
  send: 'Xác nhận lưu',
  check: 'Kiểm tra kết quả',
  cancel: 'Hủy bản chuẩn bị',
  retry: 'Gửi lại đúng yêu cầu',
  latest: 'Revision đã lưu',
  none: 'Chưa có cấu hình',
  request: 'Yêu cầu',
  keys: 'Tên biến',
  prepared: 'Đã chuẩn bị — chưa gửi',
  in_flight: 'Đang gửi',
  outcome_unknown: 'Chưa xác định kết quả',
  staged: 'Đã lưu — chưa áp dụng',
  cancelled: 'Đã hủy',
  unknown:
    'Có thể controller đã lưu. Kiểm tra kết quả trước; nếu gửi lại, app dùng đúng mã yêu cầu và nội dung đã mã hóa.',
  failure:
    'Chưa hoàn tất được thao tác. Kiểm tra kết nối, quyền quản lý và phiên bản controller, rồi tải lại hoặc kiểm tra kết quả.',
  invalid:
    'Tên biến phải viết hoa, không trùng nhau. Chỉ dùng NEXT_PUBLIC_ cho Next.js hoặc VITE_ cho SPA trong nhóm công khai. Không nhập biến hệ thống hay ký tự xuống dòng.',
  permission: 'Cần kết nối hiện hành có quyền deploy và thay đổi chính sách.',
  empty: 'Không có yêu cầu đang chờ',
  loading: 'Đang tải cấu hình',
  savedKeys: 'Chỉ hiển thị tên biến; giá trị không được đọc lại.'
}
type Copy = { [K in keyof typeof vi]: string }
const en: Copy = {
  open: 'Configuration',
  title: 'Environment variables',
  close: 'Close',
  refresh: 'Refresh',
  intro:
    'Save a complete configuration containing runtime variables and public build variables. Saved values cannot be read back.',
  stagedOnly:
    'Configuration is saved only. Deployment integration is pending; the running application stays unchanged.',
  publicWarning:
    'Public build variables may appear in browser code. Never put passwords or tokens in this group.',
  snapshot:
    'This replaces the entire configuration. Include every variable to keep; omitted variables will not belong to the new revision.',
  runtime: 'Runtime variables',
  public: 'Public build variables',
  add: 'Add variable',
  remove: 'Remove',
  key: 'Variable name',
  value: 'Value',
  consent:
    'I confirm this complete configuration and understand it is not applied to the application yet.',
  prepare: 'Prepare configuration',
  send: 'Confirm save',
  check: 'Check outcome',
  cancel: 'Cancel prepared request',
  retry: 'Resend original request',
  latest: 'Saved revision',
  none: 'No configuration saved',
  request: 'Request',
  keys: 'Variable names',
  prepared: 'Prepared — not sent',
  in_flight: 'Sending',
  outcome_unknown: 'Outcome unknown',
  staged: 'Saved — not applied',
  cancelled: 'Cancelled',
  unknown:
    'The controller may have saved this request. Check the outcome first. Resending uses the exact request ID and encrypted original content.',
  failure:
    'The operation could not be confirmed. Check connectivity, permissions and controller version, then refresh or check the outcome.',
  invalid:
    'Use unique uppercase names. Public variables require NEXT_PUBLIC_ for Next.js or VITE_ for SPA. System variables and line breaks are not allowed.',
  permission: 'A current connection with deployment and policy permissions is required.',
  empty: 'No pending request',
  loading: 'Loading configuration',
  savedKeys: 'Only names are shown; saved values are never read back.'
}
const cn: Copy = {
  open: '配置',
  title: '环境变量',
  close: '关闭',
  refresh: '刷新',
  intro: '保存包含运行变量和公开构建变量的完整配置。已保存的值不能读取。',
  stagedOnly: '仅保存配置，尚未应用到部署；当前应用保持不变。',
  publicWarning: '公开构建变量可能出现在浏览器代码中。请勿填写密码或令牌。',
  snapshot: '此操作替换整个配置。请填写所有需要保留的变量；遗漏的变量不会属于新版本。',
  runtime: '运行变量',
  public: '公开构建变量',
  add: '添加变量',
  remove: '删除',
  key: '变量名',
  value: '值',
  consent: '我确认保存完整配置，并理解其尚未应用到应用。',
  prepare: '准备配置',
  send: '确认保存',
  check: '检查结果',
  cancel: '取消准备的请求',
  retry: '重发原请求',
  latest: '已保存版本',
  none: '尚无配置',
  request: '请求',
  keys: '变量名',
  prepared: '已准备，尚未发送',
  in_flight: '发送中',
  outcome_unknown: '结果未知',
  staged: '已保存，尚未应用',
  cancelled: '已取消',
  unknown: '控制器可能已保存请求。请先检查结果；重发将使用相同请求编号和加密内容。',
  failure: '无法确认操作。请检查连接、权限和控制器版本，然后刷新或检查结果。',
  invalid:
    '变量名必须为不重复的大写名称。公开变量仅允许 Next.js 的 NEXT_PUBLIC_ 或 SPA 的 VITE_；禁止系统变量和换行。',
  permission: '需要具有部署和策略权限的当前连接。',
  empty: '无待处理请求',
  loading: '正在加载配置',
  savedKeys: '仅显示变量名，不读取已保存的值。'
}
const ja: Copy = {
  open: '設定',
  title: '環境変数',
  close: '閉じる',
  refresh: '再読み込み',
  intro: '実行時変数と公開ビルド変数を含む設定全体を保存します。保存値は再表示されません。',
  stagedOnly: '設定の保存のみです。デプロイには未適用で、稼働中のアプリは変わりません。',
  publicWarning:
    '公開ビルド変数はブラウザーのコードに含まれる場合があります。パスワードやトークンを入力しないでください。',
  snapshot:
    '設定全体を置き換えます。残す変数をすべて入力してください。省略した変数は新しいリビジョンに含まれません。',
  runtime: '実行時変数',
  public: '公開ビルド変数',
  add: '変数を追加',
  remove: '削除',
  key: '変数名',
  value: '値',
  consent: '設定全体の保存を確認します。アプリにはまだ適用されないことを理解しています。',
  prepare: '設定を準備',
  send: '保存を確認',
  check: '結果を確認',
  cancel: '準備した要求を取消',
  retry: '元の要求を再送',
  latest: '保存済みリビジョン',
  none: '保存済み設定なし',
  request: '要求',
  keys: '変数名',
  prepared: '準備済み・未送信',
  in_flight: '送信中',
  outcome_unknown: '結果不明',
  staged: '保存済み・未適用',
  cancelled: '取消済み',
  unknown:
    'コントローラーが保存済みの可能性があります。まず結果を確認してください。再送では同じ要求 ID と暗号化済みの内容を使用します。',
  failure:
    '操作結果を確認できません。接続、権限、コントローラーのバージョンを確認し、再読み込みまたは結果確認を行ってください。',
  invalid:
    '重複しない大文字の変数名を使用してください。公開変数は Next.js の NEXT_PUBLIC_ または SPA の VITE_ のみです。システム変数や改行は使用できません。',
  permission: 'デプロイとポリシーの権限を持つ現在の接続が必要です。',
  empty: '保留中の要求なし',
  loading: '設定を読み込み中',
  savedKeys: '変数名のみ表示します。保存値は読み戻しません。'
}
export const CONTROLLER_ENVIRONMENT_COPY: Record<LocaleMode, Copy> = { vi, en, cn, jp: ja }

import type { LocaleMode } from '../store/uiState'
const vi = {
  open: 'Chuẩn bị target',
  title: 'Chuẩn bị môi trường đích',
  intro:
    'Cài helper được kiểm chứng và khóa riêng cho ứng dụng trên VPS đã chọn. Bước này không build hoặc chạy ứng dụng.',
  refresh: 'Tải trạng thái',
  close: 'Đóng',
  back: 'Quay lại',
  review: 'Xem lại',
  confirm: 'Xác nhận chuẩn bị',
  inspect: 'Xác minh cấu hình cũ',
  host: 'SSH đích',
  pin: 'Fingerprint SSH',
  root: 'Thư mục private trên VPS',
  state: 'Trạng thái chuẩn bị',
  checked: 'Thời điểm kiểm tra',
  rootHint:
    'Các thư mục cha phải tồn tại và an toàn. SSH user cần quyền tạo thư mục private; ứng dụng không tự sudo, chmod hoặc nhận thư mục có sẵn không an toàn.',
  invalid: 'Nhập đường dẫn Linux tuyệt đối, không khoảng trắng, dấu .. hoặc segment quá 255 ký tự.',
  reviewHint:
    'Xác nhận đúng VPS, fingerprint và thư mục. Lần đầu sẽ tạo helper và khóa riêng. Nếu chưa rõ kết quả, chỉ kiểm tra lại cấu hình cũ; không cài lại hoặc đổi thư mục để đoán kết quả.',
  pending: 'Đang chuẩn bị hoặc kiểm tra target. Đóng cửa sổ không hủy tác vụ trên controller.',
  not_prepared: 'Chưa chuẩn bị',
  prepared: 'Đã lưu cấu hình, chưa gửi',
  unknown: 'Chưa rõ kết quả',
  enrolled: 'Đã lưu xác nhận target',
  conflict: 'Cấu hình hoặc proof không khớp',
  unknownHint:
    'Có thể đã mất phản hồi sau khi ghi lên VPS. Xác minh đúng cấu hình cũ; controller chỉ kiểm tra proof, không cài lại.',
  enrolledHint:
    'Controller đã lưu proof hợp lệ của target. Đây chưa phải deployment hoặc xác nhận runtime đang chạy; cần kiểm tra tài nguyên, Docker và runtime trước deploy.',
  conflictHint:
    'Không tiếp tục tự động. Kiểm tra cấu hình hoặc proof đã lưu với quản trị viên; không ghi đè hoặc tạo khóa thay thế.',
  failed:
    'Chưa xác nhận được kết quả. Tải lại trạng thái trước khi tiếp tục; không đổi thư mục hoặc tạo yêu cầu thay thế để đoán kết quả.',
  changed: 'Cấu hình, quyền hoặc VPS đã đổi. Tải lại dự án và xem lại trước khi tiếp tục.',
  source: 'Xác minh source là bước riêng; chuẩn bị target không tự bật auto deploy.',
  permission: 'Cần kết nối active có quyền deploy và chính sách.'
}
type Copy = { [K in keyof typeof vi]: string }
const en: Copy = {
  open: 'Prepare target',
  title: 'Target preparation',
  intro:
    'Install verified helpers and an app-specific key on the selected VPS. This does not build or run the application.',
  refresh: 'Load status',
  close: 'Close',
  back: 'Back',
  review: 'Review',
  confirm: 'Confirm preparation',
  inspect: 'Verify existing setup',
  host: 'Target SSH',
  pin: 'SSH fingerprint',
  root: 'Private directory on VPS',
  state: 'Preparation state',
  checked: 'Checked at',
  rootHint:
    'Parent directories must already exist and be safe. The SSH user needs permission to create a private base. No automatic sudo, chmod or adoption of unsafe existing paths.',
  invalid:
    'Enter an absolute Linux path without spaces, .. segments or segments longer than 255 characters.',
  reviewHint:
    'Confirm the VPS, fingerprint and directory. First preparation creates helpers and a private app key. An unknown outcome is inspected using the same setup; it is never reinstalled or replaced to guess the result.',
  pending:
    'Preparing or inspecting target. Closing this window does not cancel the controller operation.',
  not_prepared: 'Not prepared',
  prepared: 'Configuration saved, not sent',
  unknown: 'Outcome unknown',
  enrolled: 'Target confirmation stored',
  conflict: 'Configuration or proof mismatch',
  unknownHint:
    'The response may have been lost after a target write. Verify the original setup; the controller only inspects its proof and never reinstalls it.',
  enrolledHint:
    'The controller stored a valid target proof. This is not a deployment or proof of a running application. Resources, Docker and runtime checks are still required before deployment.',
  conflictHint:
    'Automatic progress is blocked. Review the stored configuration or proof with an administrator; do not overwrite it or create a replacement key.',
  failed:
    'The result could not be confirmed. Reload status before continuing; do not change the directory or replace the request to guess the outcome.',
  changed:
    'Configuration, permissions or target changed. Refresh the project and review it before continuing.',
  source: 'Source verification is separate. Preparing a target does not enable auto deploy.',
  permission: 'An active connection with deployment and policy permissions is required.'
}
const cn: Copy = {
  open: '准备目标',
  title: '目标环境准备',
  intro: '在选定 VPS 上安装经过验证的辅助程序及应用专属密钥。此步骤不会构建或运行应用。',
  refresh: '加载状态',
  close: '关闭',
  back: '返回',
  review: '复核',
  confirm: '确认准备',
  inspect: '验证原有配置',
  host: '目标 SSH',
  pin: 'SSH 指纹',
  root: 'VPS 私有目录',
  state: '准备状态',
  checked: '检查时间',
  rootHint:
    '父目录必须已存在且安全。SSH 用户需要创建私有目录的权限。不会自动 sudo、chmod 或接管不安全路径。',
  invalid: '请输入绝对 Linux 路径，不含空格、.. 或超过255字符的路径段。',
  reviewHint:
    '确认 VPS、指纹和目录。首次准备将创建辅助程序和应用密钥。结果不明时只检查原有配置，不会重新安装或替换。',
  pending: '正在准备或检查目标。关闭窗口不会取消控制器上的操作。',
  not_prepared: '尚未准备',
  prepared: '配置已保存但未发送',
  unknown: '结果不明',
  enrolled: '目标确认已保存',
  conflict: '配置或凭证不匹配',
  unknownHint: '写入目标后响应可能丢失。请验证原配置；控制器只检查凭证，不会重新安装。',
  enrolledHint:
    '控制器已保存有效目标凭证。这不代表已部署或应用正在运行。部署前仍需检查资源、Docker 和运行环境。',
  conflictHint: '自动操作已阻止。请与管理员核对配置或凭证，不要覆盖或创建替代密钥。',
  failed: '无法确认结果。继续前请重新加载状态，不要更换目录或请求以猜测结果。',
  changed: '配置、权限或目标已更改。请刷新项目后复核。',
  source: '源码验证是独立步骤。准备目标不会启用自动部署。',
  permission: '需要具有部署及策略权限的有效连接。'
}
const jp: Copy = {
  open: 'ターゲット準備',
  title: 'ターゲット環境の準備',
  intro:
    '選択した VPS に検証済みヘルパーとアプリ専用キーをインストールします。ビルドやアプリの実行は行いません。',
  refresh: '状態を取得',
  close: '閉じる',
  back: '戻る',
  review: '確認',
  confirm: '準備を確定',
  inspect: '既存設定を検証',
  host: 'ターゲット SSH',
  pin: 'SSH フィンガープリント',
  root: 'VPS のプライベートディレクトリ',
  state: '準備状態',
  checked: '確認時刻',
  rootHint:
    '親ディレクトリが安全な状態で存在し、SSH ユーザーに作成権限が必要です。自動 sudo、chmod、安全でない既存パスの使用は行いません。',
  invalid: '空白、..、255文字を超えるセグメントを含まない Linux 絶対パスを入力してください。',
  reviewHint:
    'VPS、フィンガープリント、ディレクトリを確認してください。初回はヘルパーとアプリ専用キーを作成します。結果不明時は同じ設定を検査し、再インストールや置換は行いません。',
  pending:
    'ターゲットを準備または検査しています。ウィンドウを閉じてもコントローラーの操作は取り消されません。',
  not_prepared: '未準備',
  prepared: '設定保存済み・未送信',
  unknown: '結果不明',
  enrolled: 'ターゲット確認を保存済み',
  conflict: '設定または証明が不一致',
  unknownHint:
    '書き込み後に応答が失われた可能性があります。元の設定を検証してください。再インストールせず証明のみ検査します。',
  enrolledHint:
    '有効なターゲット証明を保存しました。デプロイ済みやアプリ稼働中の証明ではありません。デプロイ前にリソース、Docker、ランタイムの確認が必要です。',
  conflictHint:
    '自動操作を停止しました。管理者と設定または証明を確認し、上書きや代替キーの作成は避けてください。',
  failed:
    '結果を確認できません。続行前に状態を再取得し、ディレクトリや要求を置き換えないでください。',
  changed: '設定、権限、またはターゲットが変更されました。プロジェクトを更新して確認してください。',
  source: 'ソース検証は別の手順です。ターゲット準備で自動デプロイは有効になりません。',
  permission: 'デプロイとポリシーの権限を持つ有効な接続が必要です。'
}
export const CONTROLLER_TARGET_COPY: Record<LocaleMode, Copy> = { vi, en, cn, jp }

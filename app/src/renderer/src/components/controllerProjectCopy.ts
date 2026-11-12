import type { LocaleMode } from '../store/uiState'
const vi = {
  title: 'Dự án Product',
  create: 'Tạo dự án',
  intro:
    'Đăng ký dự án Git với controller. Bước này tạo app và cấu hình ở chế độ tạm dừng; chưa build hoặc deploy.',
  readOnly: 'Cần kết nối đã cho phép deploy và thay đổi chế độ tự deploy để đăng ký dự án.',
  refresh: 'Tải lại',
  empty: 'Chưa có yêu cầu đăng ký dự án.',
  historyError: 'Không tải được nhật ký đăng ký dự án.',
  failed:
    'Chưa xác nhận được kết quả. Kiểm tra kết nối và thông số; nếu đã có mã yêu cầu, hãy thử lại đúng mã đó.',
  target: 'VPS đích trên controller',
  targetHint:
    'Danh sách lấy từ controller; đây là thông tin đã đăng ký, không phải xác nhận VPS đang online.',
  targetEmpty:
    'Chưa có VPS đích đủ điều kiện. Cần đăng ký VPS và fingerprint SSH trên controller trước.',
  targetError: 'Không tải được VPS đích.',
  more: 'Tải thêm VPS',
  framework: 'Loại ứng dụng',
  name: 'Tên ứng dụng',
  repo: 'Repository GitHub công khai',
  branch: 'Nhánh production',
  root: 'Thư mục dự án trong repo',
  hostPort: 'Cổng public (để trống để cấp tự động)',
  containerPort: 'Cổng ứng dụng trong container',
  health: 'Đường dẫn kiểm tra HTTP',
  limits:
    'Hiện luồng Product hỗ trợ Express hoặc Vite SPA không dùng database và không cần biến môi trường bắt buộc. Source sẽ được kiểm tra riêng trước khi deploy.',
  review: 'Xem lại cấu hình',
  confirm: 'Đăng ký dự án',
  back: 'Quay lại',
  close: 'Đóng',
  required: 'Điền đầy đủ thông tin.',
  slug: 'Dùng 2–31 ký tự thường, số và dấu gạch ngang.',
  repoInvalid: 'Nhập URL HTTPS GitHub không kèm token hoặc thông tin đăng nhập.',
  reviewTitle: 'Xác nhận đăng ký',
  confirmHint:
    'Controller sẽ tạo app/source và tạm dừng tự deploy. Còn cần kiểm tra source, enroll target và preflight trước khi bật deploy.',
  prepared: 'Chưa gửi',
  in_flight: 'Đang đăng ký',
  outcome_unknown: 'Chưa rõ kết quả',
  registered: 'Đã đăng ký dự án',
  cancelled: 'Đã hủy',
  retry: 'Thử lại đúng mã',
  cancel: 'Hủy yêu cầu chưa gửi',
  retryTitle: 'Tiếp tục đăng ký với mã yêu cầu cũ?',
  registeredHint:
    'Dự án đã được đăng ký; đây chưa phải deployment. Việc xác minh source, target và runtime còn ở bước tiếp theo.',
  unknownHint:
    'Phản hồi có thể đã mất. Thử lại dùng đúng mã cũ để controller trả cùng dự án; không tạo yêu cầu thay thế để đoán kết quả.',
  changed:
    'Kết nối hoặc thông tin VPS đích đã thay đổi. Chưa gửi tiếp; hãy tải lại và xem lại cấu hình.',
  state: 'Trạng thái đăng ký',
  updated: 'Cập nhật lần cuối',
  targetId: 'ID VPS trên controller',
  appId: 'ID ứng dụng'
}
type Copy = { [K in keyof typeof vi]: string }
const en: Copy = {
  title: 'Product projects',
  create: 'Create project',
  intro:
    'Register a Git project with the controller. This creates the app and configuration with auto deploy paused; it does not build or deploy.',
  readOnly:
    'This connection needs deployment and auto-deploy policy permissions to register projects.',
  refresh: 'Refresh',
  empty: 'No project registration requests.',
  historyError: 'Could not load project registration history.',
  failed:
    'The result could not be confirmed. Check the connection and configuration; if a request exists, retry its original key.',
  target: 'Target VPS on controller',
  targetHint:
    'These profiles come from the controller. Registration does not confirm that a VPS is currently online.',
  targetEmpty:
    'No eligible target VPS. Enroll the VPS and verified SSH fingerprint on the controller first.',
  targetError: 'Could not load target VPS profiles.',
  more: 'Load more targets',
  framework: 'Application framework',
  name: 'Application name',
  repo: 'Public GitHub repository',
  branch: 'Production branch',
  root: 'Project directory in repository',
  hostPort: 'Public port (leave empty to allocate)',
  containerPort: 'Application container port',
  health: 'HTTP health check path',
  limits:
    'Product currently supports Express or Vite SPA without a database or required environment variables. Source verification is a separate step before deployment.',
  review: 'Review configuration',
  confirm: 'Register project',
  back: 'Back',
  close: 'Close',
  required: 'Complete all required fields.',
  slug: 'Use 2–31 lowercase letters, numbers and hyphens.',
  repoInvalid: 'Enter a GitHub HTTPS URL without tokens or login information.',
  reviewTitle: 'Confirm registration',
  confirmHint:
    'The controller will create app/source records with auto deploy paused. Source verification, target enrollment and runtime preflight are still required.',
  prepared: 'Not sent',
  in_flight: 'Registering',
  outcome_unknown: 'Outcome unknown',
  registered: 'Project registered',
  cancelled: 'Cancelled',
  retry: 'Retry original key',
  cancel: 'Cancel unsent request',
  retryTitle: 'Continue registration with the original request key?',
  registeredHint:
    'The project is registered; this is not a deployment. Source, target and runtime verification are the next steps.',
  unknownHint:
    'The response may have been lost. Retry the original key to retrieve the same project; do not replace the request to guess its outcome.',
  changed:
    'The connection or target VPS metadata changed. No further command was sent; refresh and review the configuration.',
  state: 'Registration status',
  updated: 'Last updated',
  targetId: 'Controller VPS ID',
  appId: 'Application ID'
}
const cn: Copy = {
  title: 'Product 项目',
  create: '创建项目',
  intro: '向控制器注册 Git 项目。此步骤创建应用和配置并暂停自动部署，不会构建或部署。',
  readOnly: '此连接需要部署及自动部署策略权限才能注册项目。',
  refresh: '刷新',
  empty: '暂无项目注册请求。',
  historyError: '无法加载项目注册记录。',
  failed: '无法确认结果。请检查连接和配置；若已有请求，请使用原请求标识重试。',
  target: '控制器上的目标 VPS',
  targetHint: '这些配置来自控制器，已注册不表示 VPS 当前在线。',
  targetEmpty: '没有符合条件的目标 VPS。请先在控制器上注册 VPS 和已验证的 SSH 指纹。',
  targetError: '无法加载目标 VPS。',
  more: '加载更多 VPS',
  framework: '应用框架',
  name: '应用名称',
  repo: '公开 GitHub 仓库',
  branch: '生产分支',
  root: '仓库中的项目目录',
  hostPort: '公共端口（留空自动分配）',
  containerPort: '应用容器端口',
  health: 'HTTP 健康检查路径',
  limits:
    '当前 Product 流程支持不使用数据库或必需环境变量的 Express 或 Vite SPA 应用。部署前仍需单独验证源代码。',
  review: '检查配置',
  confirm: '注册项目',
  back: '返回',
  close: '关闭',
  required: '请填写完整信息。',
  slug: '使用 2–31 个小写字母、数字或连字符。',
  repoInvalid: '请输入不含令牌或登录信息的 GitHub HTTPS 地址。',
  reviewTitle: '确认注册',
  confirmHint: '控制器将创建应用和源配置并暂停自动部署。仍需验证源代码、注册目标及检查运行环境。',
  prepared: '未发送',
  in_flight: '注册中',
  outcome_unknown: '结果未知',
  registered: '项目已注册',
  cancelled: '已取消',
  retry: '使用原标识重试',
  cancel: '取消未发送请求',
  retryTitle: '使用原请求标识继续注册？',
  registeredHint: '项目已注册，但尚未部署。下一步需验证源代码、目标和运行环境。',
  unknownHint: '响应可能已丢失。请使用原请求标识取回同一项目，不要新建请求猜测结果。',
  changed: '连接或目标 VPS 信息已改变，未继续发送命令。请刷新并重新检查配置。',
  state: '注册状态',
  updated: '最近更新',
  targetId: '控制器 VPS ID',
  appId: '应用 ID'
}
const jp: Copy = {
  title: 'Product プロジェクト',
  create: 'プロジェクトを作成',
  intro:
    'Git プロジェクトをコントローラーへ登録します。アプリと設定を作成し自動デプロイを停止しますが、ビルドやデプロイは行いません。',
  readOnly: '登録にはデプロイと自動デプロイ設定の変更権限が必要です。',
  refresh: '更新',
  empty: 'プロジェクト登録要求はありません。',
  historyError: '登録履歴を読み込めません。',
  failed:
    '結果を確認できません。接続と設定を確認し、要求がある場合は元のキーで再試行してください。',
  target: 'コントローラー上の対象 VPS',
  targetHint:
    '設定はコントローラーから取得します。登録済みでも VPS が現在オンラインとは限りません。',
  targetEmpty:
    '対象 VPS がありません。先にコントローラーで VPS と検証済み SSH 指紋を登録してください。',
  targetError: '対象 VPS を読み込めません。',
  more: '対象を追加表示',
  framework: 'アプリのフレームワーク',
  name: 'アプリ名',
  repo: '公開 GitHub リポジトリ',
  branch: '本番ブランチ',
  root: 'リポジトリ内のプロジェクト',
  hostPort: '公開ポート（空欄で自動割当）',
  containerPort: 'アプリのコンテナポート',
  health: 'HTTP ヘルスチェックのパス',
  limits:
    '現在の Product はデータベースや必須環境変数を使わない Express または Vite SPA に対応しています。デプロイ前にソース検証が必要です。',
  review: '設定を確認',
  confirm: 'プロジェクトを登録',
  back: '戻る',
  close: '閉じる',
  required: '必須項目を入力してください。',
  slug: '小文字、数字、ハイフンを 2–31 文字で入力してください。',
  repoInvalid: 'トークンやログイン情報を含まない GitHub HTTPS URL を入力してください。',
  reviewTitle: '登録の確認',
  confirmHint:
    'アプリとソース設定を作成し、自動デプロイを停止します。ソース検証、対象登録、実行環境の確認が必要です。',
  prepared: '未送信',
  in_flight: '登録中',
  outcome_unknown: '結果不明',
  registered: '登録済み',
  cancelled: '取消済み',
  retry: '元のキーで再試行',
  cancel: '未送信の要求を取消',
  retryTitle: '元の要求キーで登録を続けますか？',
  registeredHint:
    'プロジェクトは登録されましたが、デプロイではありません。次にソース、対象、実行環境を検証します。',
  unknownHint:
    '応答が失われた可能性があります。同じプロジェクトを取得するには元のキーを使い、新しい要求で結果を推測しないでください。',
  changed:
    '接続または VPS 情報が変わったため、命令を追加送信していません。更新して設定を確認してください。',
  state: '登録状態',
  updated: '最終更新',
  targetId: 'コントローラー VPS ID',
  appId: 'アプリ ID'
}
export const CONTROLLER_PROJECT_COPY: Record<LocaleMode, Copy> = { vi, en, cn, jp }

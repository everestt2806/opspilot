export const CONTROLLER_ADOPTION_COPY = {
  vi: {
    review: 'Tìm controller đã nâng cấp',
    intro:
      'Dùng khi VPS đã có controller được nâng cấp từ một máy khác. Bước này chỉ kiểm tra, không cài lại hoặc thay đổi ứng dụng.',
    confirm: 'Nhận lại controller',
    consent: 'Tôi xác nhận VPS và controller bên dưới để lưu kết nối trên máy này.',
    connectConsent: 'Tôi đồng ý cấp quyền kết nối đã chọn cho máy này.',
    found: 'Đã xác minh controller hiện hành',
    adopted: 'Đã nhận lại controller. Chọn quyền và xác nhận kết nối để truy cập dữ liệu trên VPS.',
    release: 'Bản controller hiện hành',
    fingerprint: 'Fingerprint SSH',
    controller: 'Controller ID',
    unavailable:
      'Chưa xác minh được controller đã nâng cấp. Kiểm tra VPS, fingerprint và phiên bản OpsPilot rồi thử lại.'
  },
  en: {
    review: 'Find upgraded controller',
    intro:
      'Use this when the VPS has a controller upgraded from another computer. This check does not reinstall the controller or change applications.',
    confirm: 'Adopt controller',
    consent: 'I confirm the VPS and controller below to save this connection on this computer.',
    connectConsent: 'I agree to grant this computer the selected connection permissions.',
    found: 'Current controller verified',
    adopted:
      'Controller adopted. Select permissions and confirm the connection to access VPS data.',
    release: 'Current controller release',
    fingerprint: 'SSH fingerprint',
    controller: 'Controller ID',
    unavailable:
      'The upgraded controller could not be verified. Check the VPS, fingerprint and OpsPilot version, then try again.'
  },
  cn: {
    review: '查找已升级的控制器',
    intro: '适用于已在其他电脑上升级控制器的 VPS。此步骤仅检查，不会重新安装控制器或更改应用。',
    confirm: '接管控制器',
    consent: '我确认下方的 VPS 和控制器，并在本机保存连接。',
    connectConsent: '我同意向本机授予所选的连接权限。',
    found: '已验证当前控制器',
    adopted: '已接管控制器。请选择权限并确认连接以访问 VPS 数据。',
    release: '当前控制器版本',
    fingerprint: 'SSH 指纹',
    controller: '控制器 ID',
    unavailable: '无法验证已升级的控制器。请检查 VPS、指纹和 OpsPilot 版本后重试。'
  },
  jp: {
    review: '更新済みコントローラーを検索',
    intro:
      '別のパソコンでコントローラーを更新済みの VPS に使用します。確認のみ行い、再インストールやアプリの変更は行いません。',
    confirm: 'コントローラーを引き継ぐ',
    consent: '以下の VPS とコントローラーを確認し、このパソコンに接続を保存します。',
    connectConsent: '選択した接続権限をこのパソコンに付与することに同意します。',
    found: '現在のコントローラーを確認しました',
    adopted:
      '引き継ぎが完了しました。権限を選び、接続を確認して VPS のデータにアクセスしてください。',
    release: '現在のコントローラーバージョン',
    fingerprint: 'SSH フィンガープリント',
    controller: 'コントローラー ID',
    unavailable:
      '更新済みコントローラーを検証できませんでした。VPS、フィンガープリント、OpsPilot のバージョンを確認してください。'
  }
} as const

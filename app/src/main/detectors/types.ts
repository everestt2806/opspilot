/**
 * HỢP ĐỒNG: Detector engine (M3 — FR-B1, FR-B8)
 *
 * Đích khi code: app/src/main/detectors/types.ts (copy y nguyên).
 * KHÔNG sửa interface này khi đang code một detector. Muốn đổi -> xem contracts/README.md.
 *
 * "Kiến trúc plugin" trong đồ án này = một mảng object cùng interface.
 * KHÔNG dynamic loading, KHÔNG plugin runtime.
 * Thêm framework mới = thêm 1 file + 1 dòng vào mảng DETECTORS. Không sửa lõi.
 * Chính con số "N dòng, Y giờ" khi thêm Flask ở tuần 11 là bằng chứng cho tiêu chí
 * "tính mở rộng của kiến trúc detector".
 */

export type FrameworkId = 'nextjs' | 'express' | 'static-spa' | 'flask';

/**
 * Ảnh chụp thư mục source, đã được đọc sẵn để detector không phải chạm vào fs.
 * Nhờ đó detector là hàm thuần -> unit test cực dễ (chỉ cần dựng object).
 */
export interface SourceTree {
  /** Đường dẫn tuyệt đối tới thư mục gốc source trên máy người dùng */
  rootPath: string;
  /** Đường dẫn tương đối của mọi file, POSIX separator, đã loại node_modules/.git */
  files: string[];
  /** Nội dung các file quan trọng đã đọc sẵn (UTF-8). Thiếu file -> key không tồn tại. */
  readText(relPath: string): string | undefined;
  /** Parse JSON an toàn; lỗi cú pháp -> undefined, không throw */
  readJson<T = unknown>(relPath: string): T | undefined;
  /** Có file/thư mục này không */
  has(relPath: string): boolean;
}

export interface BuildPlan {
  /** Tên file trong templates/, vd 'nextjs.Dockerfile' */
  dockerfileTemplate: string;
  /** Build arg truyền vào docker build (--build-arg) */
  buildArgs: Record<string, string>;
  /** Lệnh build bên trong image, để hiển thị cho người dùng ở bước 2 của wizard */
  buildCommand: string;
  /** Lệnh chạy app trong container */
  startCommand: string;
  /** Cổng app lắng nghe BÊN TRONG container */
  containerPort: number;
  /** Đường dẫn healthcheck, vd '/' hoặc '/health' */
  healthcheckPath: string;
  /** Biến env BẮT BUỘC; thiếu thì wizard bước 3 hỏi người dùng (FR-B3) */
  requiredEnv: string[];
  /** Biến env tuỳ chọn, hiện dạng gợi ý */
  optionalEnv: string[];
  /** true -> docker-compose sinh thêm service postgres + volume */
  needsDb: boolean;
  /** Cảnh báo thao tác thủ công người dùng phải tự làm (FR-B3) */
  manualSteps: string[];
  /** Phiên bản framework đọc được, chỉ để hiển thị. vd '14.2.3' */
  detectedVersion?: string;
}

/** Một dấu hiệu đã kiểm tra — dùng để giải thích minh bạch khi KHÔNG khớp detector nào */
export interface DetectionSignal {
  /** Mô tả tiếng Việt, hiện thẳng lên UI. vd: "package.json có dependency 'next'" */
  description: string;
  passed: boolean;
  /** Giá trị thực tế tìm thấy, nếu có */
  found?: string;
}

export interface Detector {
  id: FrameworkId;
  /** Tên hiển thị. vd 'Next.js' */
  displayName: string;
  /**
   * Detector priority CAO chạy trước.
   * nextjs 30 > static-spa 20 > express 10 = flask 10
   * Lý do: cả 3 stack JS đều có package.json, phải xét cái đặc trưng nhất trước.
   */
  priority: number;

  /** Hàm thuần. Không đọc fs, không gọi mạng, không throw. */
  detect(tree: SourceTree): boolean;

  /** Danh sách dấu hiệu đã kiểm tra + kết quả, dùng cho UI khi không detector nào khớp */
  explain(tree: SourceTree): DetectionSignal[];

  /** Chỉ được gọi khi detect() === true */
  buildPlan(tree: SourceTree): BuildPlan;
}

/** Kết quả engine trả về cho UI (bước 2 của Deploy Wizard) */
export type DetectionResult =
  | {
      matched: true;
      detector: FrameworkId;
      displayName: string;
      plan: BuildPlan;
      /** Detector khác cũng khớp nhưng priority thấp hơn — hiện dạng "hoặc có thể là..." */
      alternatives: FrameworkId[];
    }
  | {
      matched: false;
      /** Toàn bộ dấu hiệu đã kiểm tra của MỌI detector, gom theo framework */
      signals: Record<FrameworkId, DetectionSignal[]>;
      /** Gợi ý tiếng Việt cho người dùng, vd "Thư mục không có package.json..." */
      hint: string;
    };

/**
 * Engine: chạy detector theo priority giảm dần, lấy cái đầu tiên detect()===true.
 * app/src/main/detectors/index.ts:
 *   export const DETECTORS: Detector[] = [nextjs, staticSpa, express]   // + flask nếu Tier 2
 *   export function detectFramework(tree: SourceTree): DetectionResult
 */
export declare function detectFramework(tree: SourceTree): DetectionResult;

/* ---------------------------------------------------------------------------
 * QUY TẮC NHẬN DIỆN ĐÃ CHỐT (khớp docs/01-ke-hoach.md M3)
 *
 *   nextjs      : package.json -> dependencies có 'next'
 *   static-spa  : package.json -> devDependencies có 'vite' VÀ KHÔNG có 'next'
 *   express     : package.json -> dependencies có 'express', không có 'next'/'vite'
 *   flask (T2)  : requirements.txt hoặc pyproject.toml có chuỗi 'flask' (không phân biệt hoa thường)
 *
 * needsDb = true khi dependencies chứa một trong: pg, prisma, typeorm, sequelize,
 *           mongoose(->cảnh báo chưa hỗ trợ), psycopg2, sqlalchemy
 *
 * requiredEnv = hằng theo framework
 *             + biến parse được từ .env.example (mọi dòng KHOÁ= ở đầu dòng)
 *             + 'DATABASE_URL' nếu needsDb
 * ------------------------------------------------------------------------- */

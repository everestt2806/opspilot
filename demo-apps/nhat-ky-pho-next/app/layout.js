import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: {
    default: "Nhật Ký Phố — Đi chậm, nhìn kỹ",
    template: "%s | Nhật Ký Phố",
  },
  description: "Một tờ nhật ký nhỏ về những buổi đi bộ và các góc phố quen.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="brand-symbol">N/P</span>
            <span>nhật ký phố</span>
          </Link>
          <nav aria-label="Điều hướng chính">
            <Link href="/#bai-viet">Bài viết</Link>
            <Link href="/#ve-trang">Về trang</Link>
          </nav>
          <span className="issue">SỐ 01 — THÁNG 10, 2026</span>
        </header>
        {children}
        <footer>
          <span>Nhật Ký Phố · Một ứng dụng mẫu</span>
          <span>Viết để nhớ những điều thường ngày.</span>
          <Link href="/health">Trạng thái hệ thống</Link>
        </footer>
      </body>
    </html>
  );
}

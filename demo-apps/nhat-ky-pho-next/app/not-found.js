import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">TRANG KHÔNG CÓ Ở ĐÂY</span>
      <h1>Đi lạc một chút thôi.</h1>
      <p>Bài viết bạn tìm không nằm trong số báo này.</p>
      <Link className="underlined-link" href="/">
        Về trang đầu ↗
      </Link>
    </main>
  );
}

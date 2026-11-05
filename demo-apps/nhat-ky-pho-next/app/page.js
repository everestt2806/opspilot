import Link from "next/link";
import { posts } from "../lib/posts";

function Artwork({ variant }) {
  return (
    <div className={`artwork artwork-${variant}`} aria-hidden="true">
      <span className="art-disc" />
      <span className="art-window" />
      <span className="art-line one" />
      <span className="art-line two" />
    </div>
  );
}

export default function HomePage() {
  const [featured, ...rest] = posts;
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">NHẬT KÝ ĐI BỘ · SỐ ĐẦU TIÊN</span>
          <h1>
            Đi chậm,
            <br />
            <em>nhìn kỹ.</em>
          </h1>
          <p>
            Một tờ ghi chép về những con đường đi qua mỗi ngày, những chỗ ngồi
            quen và các buổi chiều không vội.
          </p>
          <Link className="underlined-link" href={`/bai-viet/${featured.slug}`}>
            Đọc bài mở đầu <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="hero-art">
          <Artwork variant="morning" />
          <span className="art-caption">GHI CHÉP 01 / THÀNH PHỐ BUỔI SÁNG</span>
        </div>
      </section>

      <section className="feature-section" id="bai-viet">
        <div className="section-heading">
          <span className="eyebrow">BÀI ĐƯỢC CHỌN</span>
          <span>01 / 03</span>
        </div>
        <Link className="feature-row" href={`/bai-viet/${featured.slug}`}>
          <div>
            <p>
              {featured.category} · {featured.readTime}
            </p>
            <h2>{featured.title}</h2>
            <span>{featured.excerpt}</span>
          </div>
          <span className="feature-arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
      </section>

      <section className="more-section">
        <div className="section-heading">
          <span className="eyebrow">TRÊN TRANG NÀY</span>
          <span>Đọc một bài ngắn khi có thời gian</span>
        </div>
        <div className="story-grid">
          {rest.map((post) => (
            <article className="story-card" key={post.slug}>
              <Link
                href={`/bai-viet/${post.slug}`}
                aria-label={`Đọc ${post.title}`}
              >
                <Artwork variant={post.art} />
              </Link>
              <p className="story-meta">
                {post.number} · {post.category} · {post.readTime}
              </p>
              <h3>
                <Link href={`/bai-viet/${post.slug}`}>{post.title}</Link>
              </h3>
              <p className="story-excerpt">{post.excerpt}</p>
              <Link className="story-link" href={`/bai-viet/${post.slug}`}>
                Đọc tiếp <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="about" id="ve-trang">
        <span className="eyebrow">VỀ NHẬT KÝ PHỐ</span>
        <p>
          Không phải cẩm nang đi đâu cho đủ. Đây chỉ là những trang viết về việc
          ở lại lâu hơn một chút với nơi mình đang sống.
        </p>
        <span>Đọc khi bạn có một khoảng nghỉ.</span>
      </section>
    </main>
  );
}

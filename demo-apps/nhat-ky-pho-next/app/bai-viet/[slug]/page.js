import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, posts } from "../../../lib/posts";

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }) {
  const post = getPost(params.slug);
  return post
    ? { title: post.title, description: post.excerpt }
    : { title: "Không tìm thấy bài viết" };
}

export default function ArticlePage({ params }) {
  const post = getPost(params.slug);
  if (!post) notFound();
  const currentIndex = posts.findIndex((item) => item.slug === post.slug);
  const nextPost = posts[(currentIndex + 1) % posts.length];

  return (
    <main className="article-page">
      <div className="article-top">
        <Link href="/#bai-viet">← Tất cả bài viết</Link>
        <span>{post.number} / 03</span>
      </div>
      <header className="article-header">
        <span className="eyebrow">
          {post.category} · {post.date} · {post.readTime}
        </span>
        <h1>{post.title}</h1>
        <p>{post.lead}</p>
      </header>
      <div className={`article-art article-art-${post.art}`} aria-hidden="true">
        <span className="article-art-frame" />
        <span className="article-art-sun" />
        <small>NHẬT KÝ PHỐ / {post.number}</small>
      </div>
      <div className="article-layout">
        <aside>
          <span className="eyebrow">GHI CHÉP SỐ {post.number}</span>
          <p>Những nơi ta đi qua cũng giữ lại một phần của ngày.</p>
        </aside>
        <article className="article-body">
          {post.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <blockquote>{post.closing}</blockquote>
        </article>
      </div>
      <Link className="next-story" href={`/bai-viet/${nextPost.slug}`}>
        <span>ĐỌC TIẾP · {nextPost.category}</span>
        <strong>{nextPost.title}</strong>
        <span className="next-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
    </main>
  );
}

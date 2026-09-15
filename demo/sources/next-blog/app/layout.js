import './globals.css'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'OpsPilot Demo Blog'

export const metadata = {
  title: SITE_NAME,
  description: 'Demo blog Next.js — đối tượng deploy/thí nghiệm của OpsPilot (M12)'
}

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="site-brand" href="/">
              <span className="site-brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 15.5 12 4l7 11.5-7 4.5-7-4.5Z" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M8.5 14.8h7M12 4v16" stroke="currentColor" strokeWidth="1.7" />
                </svg>
              </span>
              <span>{SITE_NAME}</span>
            </a>
            <span className="site-header-note">Next.js 14 · App Router · static export</span>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">Deploy bởi OpsPilot · Next.js · Docker</footer>
      </body>
    </html>
  )
}

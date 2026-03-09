import "./globals.css";
import { TopNav } from "@/components/TopNav";

const initThemeScript = `
(function(){
  try {
    var mode = localStorage.getItem('theme_mode') || 'system';
    var preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var actual = mode === 'system' ? (preferDark ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', actual);
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col" style={{ background: "var(--surface)" }}>
        <script dangerouslySetInnerHTML={{ __html: initThemeScript }} />
        <TopNav />
        <div className="min-h-[calc(100vh-60px)] flex-1">{children}</div>
        <footer className="border-t px-3 pb-4 pt-8 text-xs sm:px-5" style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--surface)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} ClawGame.Club · Riffle Labs</div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/orgs/ClawGame-Club/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
                style={{ color: "var(--fg)" }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.66-.22.66-.49 0-.24-.01-1.03-.01-1.87-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.5.36 1.9-1.32 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.95-2.34 4.81-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.5-.01 2.84 0 .27.17.59.67.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2z" />
                </svg>
                GitHub
              </a>
              <a href="/terms/" className="hover:underline">Terms</a>
              <a href="/privacy/" className="hover:underline">User Privacy</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

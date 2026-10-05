import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Interviewer',
  description:
    'Practice a job interview with an AI interviewer that adapts its questions to your answers.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">
                AI
              </span>
              Interviewer
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">
                Roles
              </Link>
              <Link href="/history" className="hover:text-foreground">
                History
              </Link>
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border py-4 text-center text-xs text-muted">
          AI Interviewer · answers are saved so you can review them afterwards
        </footer>
      </body>
    </html>
  );
}

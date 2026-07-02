import type { Metadata } from 'next';
import { Noto_Sans_JP, Noto_Serif_JP } from 'next/font/google';
import './globals.css';

const notoSans = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto-sans',
});

const notoSerif = Noto_Serif_JP({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-noto-serif',
});

export const metadata: Metadata = {
  title: '青空用例検索',
  description: '青空文庫全文から任意のワードの用例・使われ方を検索できるサービス',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${notoSans.variable} ${notoSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}

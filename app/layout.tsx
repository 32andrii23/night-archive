import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ночной архив — дуэль в темноте",
  description: "Два человека. Один архив. Соберите предохранители и сбегите или не дайте уйти.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}

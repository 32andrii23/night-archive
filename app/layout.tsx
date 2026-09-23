import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Тихий корпус — хоррор для двоих",
  description: "Два друга приехали в закрытую больницу. Один ищет улики и выход, другой скрывает свою настоящую форму.",
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

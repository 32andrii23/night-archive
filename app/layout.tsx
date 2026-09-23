import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Тихий корпус — хоррор для двоих",
  // Shown in link previews of the invite, so it must not spoil who the creature is.
  description: "Ночь в закрытом корпусе психбольницы. Хоррор для двоих: найдите истории пациентов и выберитесь до конца смены.",
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

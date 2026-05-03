import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMA WebUI",
  description: "EverMemoryArchive web control panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}

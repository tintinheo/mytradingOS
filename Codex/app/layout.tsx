import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VN100 Strategy Lab",
  description: "Private trading strategy research with freshly fetched historical data.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

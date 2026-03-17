import { Providers } from "@/components/providers";

import "./globals.css";

export const metadata = {
  title: "Sonic Perps UI",
  description: "High-frequency perpetual trading UI for Sonic Market Feed Service"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

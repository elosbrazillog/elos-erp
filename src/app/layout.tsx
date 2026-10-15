import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import { Toaster } from "sonner";
import "./globals.css";


export const metadata: Metadata = {
  title: { default: "Elos ERP", template: "%s · Elos ERP" },
  description: "Sistema de gestão da Elos Distribuidora",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}

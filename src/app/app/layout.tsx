import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Elos Vendas", template: "%s · Elos Vendas" },
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "Elos Vendas", statusBarStyle: "black-translucent" },
  icons: { apple: "/icones/vendas-192.png" },
};
export const viewport: Viewport = { themeColor: "#0f2233", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-bg">{children}</div>;
}

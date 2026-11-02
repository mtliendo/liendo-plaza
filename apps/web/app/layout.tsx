import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import { QueryProviders } from "@/lib/query";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "opsz", "WONK"],
  style: ["normal", "italic"],
});

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: "Liendo Plaza",
  description: "Kitchen board and family phone for the Liendos: calendar, chores, stars, and dinner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body>
        <QueryProviders>{children}</QueryProviders>
      </body>
    </html>
  );
}

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { Shell } from "@/components/ui";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "WMAMS · कार्य व्यवस्थापन तथा बजेट अनुगमन प्रणाली",
  description: "Government of Nepal — Work Management & Budget Monitoring System pilot (MoICS, FY 2083/84)",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "WMAMS", statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#003893",
};

export default function RootLayout({ children }) {
  return (
          <html lang="en" data-scroll-behavior="smooth" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <AppProvider><Shell>{children}</Shell></AppProvider>
      </body>
    </html>
  );
}

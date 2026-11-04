import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TTSProvider } from "@/components/tts-provider";
import { SiteHeader } from "@/components/site-header";
import { SwRegister } from "@/components/sw-register";
import { Toaster } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FreeTTS — free, local-first AI text-to-speech",
  description:
    "Type text, pick a voice, hear real AI speech synthesized entirely on your device. No accounts, no fees, no text sent to any server.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FreeTTS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Set the theme class before first paint to avoid a flash.
const themeInitScript = `(function(){try{var t=localStorage.getItem("freetts-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <SwRegister />
          <TTSProvider>
            <SiteHeader />
            {/* pb-24 clears the fixed mobile tab bar (h-16 + safe area);
                md:pb-8 restores the desktop rhythm. */}
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-24 md:pb-8">
              {children}
            </main>
            <footer className="border-t">
              <div className="mx-auto max-w-6xl px-4 py-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">FreeTTS</p>
                    <p>
                      Free and open-source (GPL-3.0-or-later). Speech is
                      synthesized on your device; your text never leaves it.
                    </p>
                    <p>
                      Engine: Kokoro-82M (Apache-2.0) via kokoro-js ·
                      English voices only in this version.
                    </p>
                  </div>
                  <nav
                    className="flex gap-5 text-sm text-muted-foreground"
                    aria-label="Footer"
                  >
                    <a href="/privacy" className="transition-colors hover:text-foreground">
                      Privacy
                    </a>
                    <a href="/settings" className="transition-colors hover:text-foreground">
                      Settings
                    </a>
                  </nav>
                </div>
              </div>
            </footer>
            <Toaster />
          </TTSProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

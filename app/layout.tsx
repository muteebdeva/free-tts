import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TTSProvider } from "@/components/tts-provider";
import { SiteHeader } from "@/components/site-header";

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
        {/* lamejs MP3 encoder bundle (global `lamejs`); loaded for the
            Studio's MP3 download. Pure-JS LAME port — runs fully client-side.
            See audio/mp3-export.ts. */}
        <script src="/lame.min.js" defer />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <TTSProvider>
            <SiteHeader />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
              {children}
            </main>
            <footer className="border-t py-6">
              <div className="mx-auto max-w-6xl px-4 text-sm text-muted-foreground">
                <p>
                  FreeTTS — free and open-source (GPL-3.0-or-later). Speech is
                  synthesized on your device; your text never leaves it.
                </p>
                <p className="mt-1">
                  Engine: Kokoro-82M (Apache-2.0) via kokoro-js ·{" "}
                  <span className="underline underline-offset-4">
                    English voices only in this version
                  </span>
                  .
                </p>
              </div>
            </footer>
          </TTSProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

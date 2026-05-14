import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { resolvePreferences } from "@/i18n/preferences";

export const metadata: Metadata = {
  title: {
    default: "GENBA",
    template: "%s | GENBA",
  },
  description: "現場作業記録 SaaS — QR を中心に入庫 / ピッキング / 棚卸 / 製造を 1 端末で。",
  applicationName: "GENBA",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#172421" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, theme } = await resolvePreferences();
  const messages = await getMessages();
  const t = await getTranslations("common");
  const htmlProps =
    theme === "auto"
      ? { lang: locale }
      : { lang: locale, "data-theme": theme };

  return (
    <html {...htmlProps}>
      <body>
        <a
          href="#main"
          className="absolute left-2 top-2 z-50 -translate-y-20 bg-[var(--color-brand)] px-3 py-2 text-sm text-white focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

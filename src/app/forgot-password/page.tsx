import Link from "next/link";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "パスワード再設定" };

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] px-4 py-10">
      <section
        aria-labelledby="forgot-heading"
        className="w-full max-w-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_1px_0_0_var(--border)] sm:p-8"
      >
        <header className="mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            GENBA
          </p>
          <h1
            id="forgot-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)]"
          >
            パスワード再設定
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            ご登録メール宛にリセット用リンクをお送りします。
          </p>
        </header>
        <ForgotPasswordForm />
        <footer className="mt-6 border-t border-[var(--border)] pt-4 text-sm">
          <Link
            href="/login"
            className="text-[var(--color-brand)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            ログイン画面へ戻る
          </Link>
        </footer>
      </section>
    </main>
  );
}

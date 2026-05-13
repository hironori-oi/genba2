import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "ログイン" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] px-4 py-10">
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_1px_0_0_var(--border)] sm:p-8"
      >
        <header className="mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            GENBA
          </p>
          <h1
            id="login-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)]"
          >
            ログイン
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            アカウント情報を入力してください。
          </p>
        </header>
        <Suspense fallback={<p className="text-sm text-[var(--muted)]">読み込み中…</p>}>
          <LoginForm />
        </Suspense>
        <footer className="mt-6 flex flex-col gap-2 border-t border-[var(--border)] pt-4 text-sm">
          <Link
            href="/forgot-password"
            className="text-[var(--color-brand)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            パスワードをお忘れの方はこちら
          </Link>
          <Link
            href="/"
            className="text-[var(--muted)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            トップへ戻る
          </Link>
        </footer>
      </section>
    </main>
  );
}

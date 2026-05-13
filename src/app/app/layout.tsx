import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Alert } from "@/components/ui/Alert";
import { getAppSession } from "@/lib/auth/session";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getAppSession();

  if (result.kind === "unconfigured") {
    return (
      <main className="grid min-h-dvh place-items-center px-6 py-10">
        <div className="w-full max-w-xl">
          <Alert tone="warn" title="セットアップ中">
            Supabase 接続情報が未設定のため、保護されたアプリ画面はまだ利用できません。
            オーナーが `.env.enc` に認証情報を登録するまでお待ちください。
          </Alert>
        </div>
      </main>
    );
  }

  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app");
  }

  const { session } = result;
  return (
    <AppShell
      role={session.role}
      email={session.email}
      displayName={session.displayName}
      tenantId={session.tenantId}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}

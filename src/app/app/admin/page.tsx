import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";

type AdminCard = {
  href: string;
  titleKey: string;
  badge: string;
  description: string;
  phase6Pending?: boolean;
};

const CARDS: AdminCard[] = [
  {
    href: "/app/admin/fields",
    titleKey: "fields",
    badge: "項",
    description:
      "標準項目の利用 ON/OFF と用途 (5 種)、カスタム項目 (custom_text/number/date) の意味付けを編集します。",
  },
  {
    href: "/app/admin/qr-formats",
    titleKey: "qr",
    badge: "Q",
    description:
      "QR フォーマット V1/V2... の追加・編集・新バージョン複製、項目位置・型を編集します。",
  },
  {
    href: "/app/admin/qr",
    titleKey: "qrTest",
    badge: "T",
    description:
      "登録済バージョンを用いて、実際の QR ペイロードの解析結果を確認します (読み取りのみ)。",
  },
  {
    href: "/app/admin/match-rules",
    titleKey: "matchRules",
    badge: "照",
    description:
      "2 点照合のフィールド対応・比較方法・NG/警告ポリシーを差分 UPSERT で編集します。",
  },
  {
    href: "/app/admin/csv-formats",
    titleKey: "csvFormats",
    badge: "C",
    description:
      "業務別の CSV インポート / エクスポート定義 (列マッピング・エンコード・区切り文字・重複時挙動) を編集します。",
  },
  {
    href: "/app/admin/work-settings",
    titleKey: "workSettings",
    badge: "業",
    description:
      "業務別 (入庫 / ピッキング / 棚卸 / 製造) の作業モード・照合・NG フロー・紐付フォーマット・入力対象項目を編集します。",
  },
  {
    href: "/app/admin/masters",
    titleKey: "masters",
    badge: "製",
    description:
      "作業区分 / 工程 / 設備 / 不適合グループ / 不適合 の 5 マスタを管理します。",
  },
  {
    href: "/app/admin/corrections-pending",
    titleKey: "correctionsPending",
    badge: "承",
    description:
      "correction_approval=true のテナントで申請された訂正を一覧し、リーダーが承認します。",
  },
  {
    href: "/app/admin/reports",
    titleKey: "reports",
    badge: "報",
    description:
      "日次 / 週次 / 月次の業務サマリと KPI を集計・可視化します。CSV ダウンロードに対応。",
  },
  {
    href: "/app/admin/users",
    titleKey: "users",
    badge: "U",
    description:
      "自テナントのユーザー一覧 / ロール変更 / トークン失効を行います。他テナントは RLS で遮断されます。",
  },
  {
    href: "/app/admin/usage",
    titleKey: "usage",
    badge: "%",
    description:
      "月間スキャン件数とテナント上限の達成率 (80% で警告 / 上限到達でエラー)。",
  },
  {
    href: "/app/admin/audit-logs",
    titleKey: "auditLogs",
    badge: "監",
    description:
      "設定変更 (work_settings / match_rules / qr_format_definitions / profiles など) と訂正履歴を新しい順に閲覧、CSV 出力できます。",
  },
  {
    href: "/app/admin/notifications",
    titleKey: "notifications",
    badge: "通",
    description:
      "訂正承認や上限到達などの通知 (SMTP / webhook) のテナント設定。パスワードは保存後にクライアントから読み取れません。",
  },
  {
    href: "/app/admin/tenants",
    titleKey: "tenants",
    badge: "テ",
    description:
      "テナントの利用業務 / 上限 / プランを管理します (system_admin 限定。tenant_admin はアクセス不可)。",
  },
];

export default async function AdminIndex({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tNav = await getTranslations("nav");
  const tAdmin = await getTranslations("admin");
  const sp = (await searchParams) ?? {};
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  return (
    <div className="flex flex-col gap-4">
      {notice === "system-admin-only" ? (
        <Alert tone="warn" title={tAdmin("noticeSystemAdminOnlyTitle")}>
          <p data-testid="admin-notice-system-admin-only">
            {tAdmin("noticeSystemAdminOnlyBody")}
          </p>
        </Alert>
      ) : null}
      <ul
        data-testid="admin-card-grid"
        aria-label={tAdmin("indexAria")}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {CARDS.map((c) => (
        <li key={c.href}>
          <Link
            href={c.href}
            className="flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <header className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center bg-[var(--color-brand)] font-mono text-base font-semibold text-[var(--color-brand-foreground)]"
              >
                {c.badge}
              </span>
              <h2 className="flex-1 text-base font-semibold text-[var(--ink)]">
                {tNav(c.titleKey)}
              </h2>
              {c.phase6Pending ? (
                <span
                  data-testid="phase6-pending-chip"
                  className="border border-[var(--color-warn)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-warn)]"
                >
                  {tAdmin("phase6InProgress")}
                </span>
              ) : null}
            </header>
            <p className="text-sm text-[var(--muted)]">{c.description}</p>
          </Link>
        </li>
      ))}
      </ul>
    </div>
  );
}

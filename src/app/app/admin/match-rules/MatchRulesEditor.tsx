"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { MatchRule } from "@/lib/admin/fixtures";
import { saveMatchRuleAction, deleteMatchRuleAction } from "./actions";

type FieldOption = { code: string; label: string };

const BUSINESS_OPTIONS = [
  { value: "receiving", label: "入庫" },
  { value: "picking", label: "ピッキング" },
  { value: "inventory", label: "棚卸" },
  { value: "manufacturing", label: "製造" },
] as const;

const COMPARE_OPTIONS = [
  { value: "equals", label: "完全一致 (NFC)" },
  { value: "numeric_equals", label: "数値一致 (前置0許容)" },
] as const;

const MISSING_OPTIONS = [
  { value: "ng", label: "NG" },
  { value: "warning", label: "警告" },
  { value: "skip", label: "スキップ" },
] as const;

const MISMATCH_OPTIONS = [
  { value: "ng", label: "NG" },
  { value: "warning", label: "警告" },
] as const;

function newEmptyRule(): MatchRule {
  return {
    id: `new-${Math.random().toString(36).slice(2, 10)}`,
    ruleCode: "",
    ruleName: "",
    businessCode: "picking",
    enabled: true,
    lines: [],
  };
}

function newEmptyLine(sortOrder: number): MatchRule["lines"][number] {
  return {
    sortOrder,
    lineFieldCode: "",
    labelFieldCode: "",
    compareType: "equals",
    missingValueAction: "ng",
    mismatchAction: "ng",
  };
}

export function MatchRulesEditor({
  initial,
  fieldOptions,
}: {
  initial: MatchRule[];
  fieldOptions: FieldOption[];
}) {
  const [rules, setRules] = useState<MatchRule[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [draft, setDraft] = useState<MatchRule | null>(
    initial[0] ? structuredClone(initial[0]) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function selectRule(id: string) {
    const found = rules.find((r) => r.id === id);
    setSelectedId(id);
    setDraft(found ? structuredClone(found) : null);
    setNotice(null);
    setError(null);
  }

  function startCreate() {
    const blank = newEmptyRule();
    setSelectedId(blank.id);
    setDraft(blank);
    setNotice(null);
    setError(null);
  }

  function duplicate(rule: MatchRule) {
    const copy: MatchRule = {
      ...structuredClone(rule),
      id: `new-${Math.random().toString(36).slice(2, 10)}`,
      ruleCode: `${rule.ruleCode}-COPY`,
      ruleName: `${rule.ruleName} (複製)`,
    };
    setSelectedId(copy.id);
    setDraft(copy);
    setNotice("複製しました。コードと内容を編集して保存してください。");
    setError(null);
  }

  function addLine() {
    if (!draft) return;
    setDraft({
      ...draft,
      lines: [...draft.lines, newEmptyLine(draft.lines.length + 1)],
    });
  }

  function updateLine(idx: number, patch: Partial<MatchRule["lines"][number]>) {
    if (!draft) return;
    setDraft({
      ...draft,
      lines: draft.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    });
  }

  function removeLine(idx: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      lines: draft.lines.filter((_, i) => i !== idx).map((l, i) => ({ ...l, sortOrder: i + 1 })),
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveMatchRuleAction(draft);
      if (result.status !== "ok") {
        setError(result.message);
        return;
      }
      const persistedId = result.data.id;
      // Reflect back into list (replace optimistic id with the DB-assigned uuid).
      setRules((prev) => {
        const existing = prev.findIndex((r) => r.id === draft.id);
        const saved = { ...draft, id: persistedId };
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setSelectedId(persistedId);
      setDraft({ ...draft, id: persistedId });
      setNotice("保存しました。");
    });
  }

  function onDelete() {
    if (!draft || !selectedId) return;
    if (!confirm(`照合ルール "${draft.ruleName || draft.ruleCode}" を削除しますか？`)) return;
    startTransition(async () => {
      const result = await deleteMatchRuleAction(selectedId);
      if (result.status !== "ok") {
        setError(result.message);
        return;
      }
      setRules((prev) => prev.filter((r) => r.id !== selectedId));
      setSelectedId(null);
      setDraft(null);
      setNotice("削除しました。");
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside aria-label="ルール一覧" className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface)] p-3">
        <Button type="button" size="md" onClick={startCreate}>
          新規ルール
        </Button>
        <ul className="flex flex-col gap-1">
          {rules.length === 0 ? (
            <li className="px-2 py-3 text-sm text-[var(--muted)]">ルールがありません。</li>
          ) : (
            rules.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => selectRule(r.id)}
                  aria-pressed={selectedId === r.id}
                  className={
                    "flex w-full flex-col items-start gap-1 border-l-[3px] px-3 py-2 text-left " +
                    (selectedId === r.id
                      ? "border-[var(--color-brand)] bg-[var(--surface-2)]"
                      : "border-transparent hover:border-[var(--color-brand)] hover:bg-[var(--surface-2)]")
                  }
                >
                  <span className="font-mono text-xs text-[var(--muted)]">{r.ruleCode || "(コード未設定)"}</span>
                  <span className="text-sm text-[var(--ink)]">{r.ruleName || "(名称未設定)"}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {BUSINESS_OPTIONS.find((b) => b.value === r.businessCode)?.label} / {r.lines.length} 件
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section aria-label="編集" className="flex flex-col gap-4">
        {!draft ? (
          <Alert tone="info" title="ルールを選択">
            左の一覧からルールを選ぶか、新規ルールを作成してください。
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rule-code" className="text-sm font-medium text-[var(--ink)]">
                  ルールコード <span className="text-[var(--color-bad)]">*</span>
                </label>
                <input
                  id="rule-code"
                  required
                  value={draft.ruleCode}
                  onChange={(e) => setDraft({ ...draft, ruleCode: e.target.value })}
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-base text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rule-name" className="text-sm font-medium text-[var(--ink)]">
                  ルール名
                </label>
                <input
                  id="rule-name"
                  value={draft.ruleName}
                  onChange={(e) => setDraft({ ...draft, ruleName: e.target.value })}
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rule-business" className="text-sm font-medium text-[var(--ink)]">
                  対象業務
                </label>
                <select
                  id="rule-business"
                  value={draft.businessCode}
                  onChange={(e) =>
                    setDraft({ ...draft, businessCode: e.target.value as MatchRule["businessCode"] })
                  }
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                >
                  {BUSINESS_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    className="h-5 w-5 accent-[var(--color-brand)]"
                  />
                  ルールを有効にする
                </label>
              </div>
            </div>

            <section aria-labelledby="lines-heading" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 id="lines-heading" className="text-sm font-semibold text-[var(--ink)]">
                  比較ライン
                </h3>
                <Button type="button" size="md" variant="ghost" onClick={addLine}>
                  + ラインを追加
                </Button>
              </div>
              {draft.lines.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">ラインが未登録です。「+ ラインを追加」から作成してください。</p>
              ) : (
                <div className="overflow-x-auto border border-[var(--border)]">
                  <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                    <thead className="bg-[var(--surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th scope="col" className="px-2 py-2">順序</th>
                        <th scope="col" className="px-2 py-2">明細項目</th>
                        <th scope="col" className="px-2 py-2">ラベル項目</th>
                        <th scope="col" className="px-2 py-2">比較</th>
                        <th scope="col" className="px-2 py-2">欠落時</th>
                        <th scope="col" className="px-2 py-2">不一致時</th>
                        <th scope="col" className="px-2 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                      {draft.lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-2 py-2 font-mono text-xs">{line.sortOrder}</td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`明細項目 ${idx + 1}`}
                              value={line.lineFieldCode}
                              onChange={(e) => updateLine(idx, { lineFieldCode: e.target.value })}
                              className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              <option value="">(選択)</option>
                              {fieldOptions.map((f) => (
                                <option key={f.code} value={f.code}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`ラベル項目 ${idx + 1}`}
                              value={line.labelFieldCode}
                              onChange={(e) => updateLine(idx, { labelFieldCode: e.target.value })}
                              className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              <option value="">(選択)</option>
                              {fieldOptions.map((f) => (
                                <option key={f.code} value={f.code}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`比較方法 ${idx + 1}`}
                              value={line.compareType}
                              onChange={(e) =>
                                updateLine(idx, { compareType: e.target.value as MatchRule["lines"][number]["compareType"] })
                              }
                              className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              {COMPARE_OPTIONS.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`欠落時 ${idx + 1}`}
                              value={line.missingValueAction}
                              onChange={(e) =>
                                updateLine(idx, { missingValueAction: e.target.value as MatchRule["lines"][number]["missingValueAction"] })
                              }
                              className="h-10 w-full min-w-24 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              {MISSING_OPTIONS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`不一致時 ${idx + 1}`}
                              value={line.mismatchAction}
                              onChange={(e) =>
                                updateLine(idx, { mismatchAction: e.target.value as MatchRule["lines"][number]["mismatchAction"] })
                              }
                              className="h-10 w-full min-w-24 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              {MISMATCH_OPTIONS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              type="button"
                              size="md"
                              variant="ghost"
                              onClick={() => removeLine(idx)}
                              aria-label={`ライン ${idx + 1} を削除`}
                            >
                              削除
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {error ? (
              <Alert tone="error" title="保存エラー">
                {error}
              </Alert>
            ) : null}
            {notice ? (
              <Alert tone="ok" title="完了">
                {notice}
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                onClick={() => duplicate(draft)}
              >
                複製
              </Button>
              <Button
                type="button"
                size="lg"
                variant="danger"
                onClick={onDelete}
                disabled={pending || draft.id.startsWith("new-")}
                aria-label="このルールを削除"
              >
                削除
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { adminWriteErrorMessage, guardAdminAction } from '../../utils/adminGuard';
import { toast } from '../../stores/useToastStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SettingSwitch } from '../ui/SettingSwitch';
import {
  type BillingPeriod,
  type CreditPackage,
  type CreditPackageInput,
  type PackageKind,
  creditPackageService,
  formatCredits,
  formatPrice,
} from '../../services/creditPackageService';

/**
 * বাংলা মন্তব্য: Admin → Users → Plans & Packages।
 * "Boost my limit"-এর পেইড অংশে যা দেখায় (প্ল্যান + ক্রেডিট প্যাক) — নাম, ক্রেডিট লিমিট, দাম
 * সব এখান থেকে যোগ/এডিট/মুছে ফেলা যায়, DB-তে (`credit_packages`) সেভ হয়। কোডে কিছু হার্ডকোড নেই।
 * দেখানো/লুকানো সুইচ অটো-সেভ; মুছে ফেলার আগে নিরাপত্তা-নিশ্চিতকরণ।
 */

interface FormState {
  kind: PackageKind;
  name: string;
  description: string;
  credits: string;
  priceUsd: string;
  billingPeriod: BillingPeriod;
  badge: '' | 'popular' | 'bestValue';
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  kind: 'topup',
  name: '',
  description: '',
  credits: '',
  priceUsd: '',
  billingPeriod: 'one_time',
  badge: '',
  sortOrder: '100',
};

const inputClass =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm';

const toForm = (p: CreditPackage): FormState => ({
  kind: p.kind,
  name: p.name,
  description: p.description || '',
  credits: String(p.credits),
  priceUsd: String(p.priceUsd),
  billingPeriod: p.billingPeriod,
  badge: p.badge === 'popular' || p.badge === 'bestValue' ? p.badge : '',
  sortOrder: String(p.sortOrder),
});

export const AdminPackagesView: React.FC = () => {
  const { lang } = useI18n();
  const L = (bnText: string, enText: string) => (lang === 'bn' ? bnText : enText);

  const [packages, setPackages] = useState<CreditPackage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** `null` = form closed, `'new'` = adding, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPackages(await creditPackageService.listAll());
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, 'Could not load packages.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditing('new');
  };
  const openEdit = (p: CreditPackage) => {
    setForm(toForm(p));
    setEditing(p.id);
  };
  const closeForm = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: CreditPackageInput = {
      kind: form.kind,
      name: form.name.trim(),
      description: form.description.trim(),
      credits: Number(form.credits),
      priceUsd: Number(form.priceUsd),
      billingPeriod: form.billingPeriod,
      badge: form.badge,
      sortOrder: Number(form.sortOrder) || 0,
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        await creditPackageService.create(input);
        toast.success(L('প্যাকেজ যোগ হয়েছে', 'Package added'), input.name);
      } else if (editing) {
        await creditPackageService.update(editing, input);
        toast.success(L('প্যাকেজ আপডেট হয়েছে', 'Package updated'), input.name);
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(
        L('সেভ হয়নি', 'Not saved'),
        adminWriteErrorMessage(err, 'Could not save package.')
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (p: CreditPackage, active: boolean) => {
    // বাংলা মন্তব্য: অপটিমিস্টিক অটো-সেভ — ব্যর্থ হলে রিলোডে আগের অবস্থা ফেরে।
    setPackages((prev) => prev?.map((x) => (x.id === p.id ? { ...x, active } : x)) ?? prev);
    try {
      await creditPackageService.update(p.id, { active });
    } catch (err) {
      toast.error(
        L('সেভ হয়নি', 'Not saved'),
        adminWriteErrorMessage(err, 'Could not save package.')
      );
      await load();
    }
  };

  const remove = (p: CreditPackage) => {
    guardAdminAction({
      title: L('প্যাকেজ মুছে ফেলবেন?', 'Remove package?'),
      description: L(
        `"${p.name}" ইউজারদের "Boost my limit" পেজ থেকে চিরতরে সরে যাবে। শুধু লুকাতে চাইলে সুইচ বন্ধ করুন।`,
        `"${p.name}" disappears from everyone's "Boost my limit" page for good. To hide it temporarily, switch it off instead.`
      ),
      impactSummary: `package="${p.name}" ${formatCredits(p.credits)} credits ${formatPrice(p.priceUsd)}`,
      riskLevel: 'medium',
      run: async () => {
        try {
          await creditPackageService.remove(p.id);
          toast.success(L('প্যাকেজ মুছে ফেলা হয়েছে', 'Package removed'), p.name);
        } catch (err) {
          toast.error(
            L('মুছে ফেলা যায়নি', 'Not removed'),
            adminWriteErrorMessage(err, 'Could not remove package.')
          );
        }
        await load();
      },
    });
  };

  const kindOptions = [
    { value: 'plan' as const, label: L('প্ল্যান', 'Plan') },
    { value: 'topup' as const, label: L('ক্রেডিট প্যাক', 'Credit pack') },
  ];
  const periodOptions = [
    { value: 'one_time' as const, label: L('এককালীন', 'One-time') },
    { value: 'monthly' as const, label: L('মাসিক', 'Monthly') },
    { value: 'yearly' as const, label: L('বার্ষিক', 'Yearly') },
  ];
  const badgeOptions = [
    { value: '' as const, label: L('নেই', 'None') },
    { value: 'popular' as const, label: L('জনপ্রিয়', 'Popular') },
    { value: 'bestValue' as const, label: L('সেরা দাম', 'Best value') },
  ];
  const periodSuffix = (p: CreditPackage) =>
    p.billingPeriod === 'monthly' ? '/mo' : p.billingPeriod === 'yearly' ? '/yr' : '';

  const renderForm = () => (
    <form
      onSubmit={save}
      data-testid="package-form"
      className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SegmentedControl
          label={L('ধরন', 'Type')}
          value={form.kind}
          options={kindOptions}
          onChange={(v) => {
            set('kind', v);
            set('billingPeriod', v === 'plan' ? 'monthly' : 'one_time');
          }}
          size="sm"
          testId="package-kind"
        />
        <SegmentedControl
          label={L('বিলিং', 'Billing')}
          value={form.billingPeriod}
          options={periodOptions}
          onChange={(v) => set('billingPeriod', v)}
          size="sm"
          testId="package-period"
        />
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {L('প্যাকেজের নাম', 'Package name')}
        </span>
        <input
          className={inputClass}
          value={form.name}
          maxLength={60}
          required
          onChange={(e) => set('name', e.target.value)}
          placeholder={L('যেমন: Growth pack', 'e.g. Growth pack')}
          data-testid="package-name"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {L('ক্রেডিট লিমিট', 'Credit limit')}
          </span>
          <input
            className={inputClass}
            type="number"
            min={1}
            step={1}
            required
            value={form.credits}
            onChange={(e) => set('credits', e.target.value)}
            placeholder="1500000"
            data-testid="package-credits"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {L('দাম (USD)', 'Price (USD)')}
          </span>
          <input
            className={inputClass}
            type="number"
            min={0}
            step="0.01"
            required
            value={form.priceUsd}
            onChange={(e) => set('priceUsd', e.target.value)}
            placeholder="50"
            data-testid="package-price"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {L('ক্রম (ছোট আগে)', 'Order (lower first)')}
          </span>
          <input
            className={inputClass}
            type="number"
            step={1}
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
            data-testid="package-order"
          />
        </label>
      </div>
      <SegmentedControl
        label={L('ব্যাজ', 'Badge')}
        value={form.badge}
        options={badgeOptions}
        onChange={(v) => set('badge', v)}
        size="sm"
        testId="package-badge"
      />
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {L('ছোট বিবরণ (ঐচ্ছিক)', 'Short description (optional)')}
        </span>
        <input
          className={inputClass}
          value={form.description}
          maxLength={240}
          onChange={(e) => set('description', e.target.value)}
          data-testid="package-description"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={closeForm}
          className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {L('বাতিল', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={busy}
          data-testid="package-save"
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {editing === 'new' ? L('যোগ করুন', 'Add package') : L('আপডেট করুন', 'Update')}
        </button>
      </div>
    </form>
  );

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-packages"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {L('প্ল্যান ও প্যাকেজ', 'Plans & Packages')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {L(
              'ইউজারের "Boost my limit" পেজের পেইড অংশে যা দেখায় — নাম, ক্রেডিট আর দাম এখান থেকেই ঠিক হয়।',
              'What users see in the paid part of "Boost my limit" — names, credits and prices are set here.'
            )}
          </p>
        </div>
        {editing === null && (
          <button
            type="button"
            onClick={openNew}
            data-testid="package-add"
            className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700"
          >
            <Plus className="w-3.5 h-3.5" />
            {L('নতুন প্যাকেজ', 'New package')}
          </button>
        )}
      </div>

      {editing === 'new' && renderForm()}

      {!packages && !loadError ? (
        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
      ) : loadError && !packages ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
        >
          {loadError}
        </div>
      ) : packages && packages.length === 0 && editing !== 'new' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          {L(
            'কোনো প্যাকেজ নেই — ইউজাররা এখন শুধু ফ্রি (নিজের কী) অংশ দেখছে।',
            'No packages yet — users currently see only the free (own key) part.'
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {(packages || []).map((p) =>
            editing === p.id ? (
              <React.Fragment key={p.id}>{renderForm()}</React.Fragment>
            ) : (
              <div
                key={p.id}
                data-testid={`package-row-${p.id}`}
                className={`rounded-2xl border p-4 flex flex-wrap items-center gap-4 ${
                  p.active
                    ? 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40'
                    : 'border-dashed border-slate-300 dark:border-slate-700 opacity-70'
                }`}
              >
                <Package className="w-5 h-5 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-[12rem]">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    {p.name}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                      {p.kind === 'plan' ? L('প্ল্যান', 'Plan') : L('ক্রেডিট প্যাক', 'Credit pack')}
                    </span>
                    {p.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300">
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {formatCredits(p.credits)} {L('ক্রেডিট', 'credits')} · {formatPrice(p.priceUsd)}
                    {periodSuffix(p)}
                    {p.description ? ` · ${p.description}` : ''}
                  </div>
                </div>
                <SettingSwitch
                  label={p.active ? L('দেখানো হচ্ছে', 'Visible') : L('লুকানো', 'Hidden')}
                  checked={p.active}
                  onChange={(checked) => void toggleActive(p, checked)}
                  testId={`package-active-${p.id}`}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    disabled={editing !== null}
                    className="text-xs inline-flex items-center gap-1 text-sky-600 hover:underline disabled:opacity-40"
                    data-testid={`package-edit-${p.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {L('এডিট', 'Edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className="text-xs inline-flex items-center gap-1 text-rose-600 hover:underline"
                    data-testid={`package-remove-${p.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {L('মুছুন', 'Remove')}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default AdminPackagesView;

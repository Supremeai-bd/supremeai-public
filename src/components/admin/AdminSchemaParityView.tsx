import React, { useState, useEffect } from 'react';
import {
  Database,
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Shield,
  Layers,
  Table,
  Check,
  FileCode2,
  X,
} from 'lucide-react';
import { SchemaParityTable } from '../../types';
import { adminService } from '../../services/adminService';
import { useI18n } from '../../utils/i18n';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useAdminCollectionSource } from '../../hooks/useAdminCollectionSource';

interface TableDetailItem {
  name: string;
  localColumns: number;
  stagingColumns: number;
  prodColumns: number;
  rlsEnabled: boolean;
  driftDetected: boolean;
  lastMigration: string;
  driftSummary?: string;
}

function mapSchemaTables(tables?: SchemaParityTable[]): TableDetailItem[] {
  if (!Array.isArray(tables)) return [];
  return tables.map((live, idx) => ({
    // বাংলা মন্তব্য: এজ প্যারিটি বা ব্যাকএন্ড থেকে tableName অথবা name যে-কোনোটি এলেও নিরাপদে ম্যাপ হবে।
    name: live.tableName || (live as unknown as { name?: string }).name || `table_${idx + 1}`,
    localColumns: live.localColumns || 0,
    stagingColumns: live.stagingColumns || 0,
    prodColumns: live.prodColumns || 0,
    rlsEnabled: Boolean(live.rlsEnabled),
    driftDetected: Boolean(live.driftDetected),
    lastMigration: live.lastMigrated || '—',
    driftSummary: live.driftSummary,
  }));
}

interface AdminSchemaParityViewProps {
  tables?: SchemaParityTable[];
  onRunParitySync?: () => void;
}

export const AdminSchemaParityView: React.FC<AdminSchemaParityViewProps> = ({
  tables: initialTables,
  onRunParitySync,
}) => {
  const { t } = useI18n();

  // বাংলা মন্তব্য: স্কিমা প্যারিটি ডেটা লাইভ Supabase ইন্ট্রোস্পেকশন থেকে এসেছে কি না।
  const dataSource = useAdminCollectionSource(
    'schema',
    'স্কিমা প্যারিটি টেবিল এখনো লাইভ সিঙ্ক হয়নি — localStorage ক্যাশ/ফলব্যাক ডেটা দেখানো হচ্ছে।'
  );
  const [tableList, setTableList] = useState<TableDetailItem[]>(() =>
    mapSchemaTables(initialTables)
  );
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [selectedTable, setSelectedTable] = useState<TableDetailItem | null>(null);

  useEffect(() => {
    setTableList(mapSchemaTables(initialTables));
  }, [initialTables]);

  const driftCount = tableList.filter((item) => item.driftDetected).length;
  const rlsCount = tableList.filter((item) => item.rlsEnabled).length;
  const rlsPercent = tableList.length > 0 ? Math.round((rlsCount / tableList.length) * 100) : 0;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await adminService.syncSchemaParity();
      if (Array.isArray(res?.tables)) {
        const mapped = mapSchemaTables(res.tables);
        setTableList(mapped);
        if (selectedTable) {
          const updated = mapped.find((m) => m.name === selectedTable.name) || null;
          setSelectedTable(updated);
        }
      }
      if (onRunParitySync) onRunParitySync();
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2500);
    } catch {
      if (onRunParitySync) onRunParitySync();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-7xl mx-auto space-y-6 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-500" />
              {t.schemaParityTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
              PostgreSQL / pgvector
            </span>
            <DataSourceBadge
              source={dataSource.source}
              reason={dataSource.reason}
              ageMs={dataSource.ageMs}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Compare local migrations, staging schema, and live production tables with row-level
            security verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {syncing ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>Checking Schema Parity...</span>
              </>
            ) : syncSuccess ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                <span>Parity Verified</span>
              </>
            ) : (
              <>
                <GitCompare className="w-4 h-4" />
                <span>{t.runParitySyncBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cluster Overview Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400 shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Tracked Core Tables</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {tableList.length} Tables Monitored
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              driftCount > 0
                ? 'bg-red-50 dark:bg-red-950/60 text-red-600'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600'
            }`}
          >
            {driftCount > 0 ? (
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Schema Drift State</div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                driftCount > 0 ? 'text-red-500' : 'text-emerald-500'
              }`}
            >
              {tableList.length === 0
                ? 'Awaiting Schema Registry'
                : driftCount > 0
                  ? `${driftCount} Table Drift Detected`
                  : '100% Schema Parity'}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Row-Level Security (RLS)</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {tableList.length > 0
                ? `Enforced on ${rlsCount}/${tableList.length} (${rlsPercent}%)`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Schema Parity Visual Tree */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Database Table Parity & Migration Status
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Click table row for environment breakdown
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-mono uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3">Table Name</th>
                <th className="px-5 py-3">Local / Staging / Prod Cols</th>
                <th className="px-5 py-3">Latest Migration</th>
                <th className="px-5 py-3">RLS Security</th>
                <th className="px-5 py-3">Parity Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {tableList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center font-sans text-slate-400">
                    No schema parity records loaded yet. Click "{t.runParitySyncBtn}" to inspect
                    backend schema state.
                  </td>
                </tr>
              ) : (
                tableList.map((row) => (
                  <tr
                    key={row.name}
                    onClick={() => setSelectedTable(row)}
                    className={`cursor-pointer transition-colors ${
                      row.driftDetected
                        ? 'bg-red-500/10 hover:bg-red-500/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-5 py-3.5 font-bold text-slate-900 dark:text-white flex items-center gap-2 font-sans">
                      <Table className="w-4 h-4 text-slate-400" />
                      <span>{row.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                      {row.localColumns} / {row.stagingColumns} / {row.prodColumns}
                    </td>
                    <td className="px-5 py-3.5 text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>{row.lastMigration}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          row.rlsEnabled
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                        }`}
                      >
                        <Shield className="w-3 h-3" /> {row.rlsEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.driftDetected ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
                          <AlertTriangle className="w-3 h-3" /> Drift Detected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                          <CheckCircle2 className="w-3 h-3" /> Synced
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-out Table Diff Drawer */}
      {selectedTable && (
        <div className="fixed inset-y-0 right-0 w-88 sm:w-[440px] bg-slate-900 border-l border-slate-800 p-6 shadow-2xl z-50 flex flex-col justify-between overflow-y-auto text-slate-200">
          <div className="space-y-5">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Table className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="font-bold text-base text-white">{selectedTable.name}</h3>
                  <span className="text-xs text-slate-400 font-mono">
                    {selectedTable.lastMigration}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTable(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              className={`p-3 rounded-xl border flex items-center justify-between ${
                selectedTable.driftDetected
                  ? 'bg-red-950/60 border-red-500/50 text-red-200'
                  : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
              }`}
            >
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider block opacity-75">
                  Cluster Parity
                </span>
                <span className="text-sm font-bold">
                  {selectedTable.driftDetected ? 'Drift / Column Mismatch' : '100% In Sync'}
                </span>
              </div>
              <span className="text-xs font-mono font-semibold px-2 py-1 rounded bg-black/40">
                RLS {selectedTable.rlsEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-xs text-center">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">Local</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {selectedTable.localColumns}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">Staging</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {selectedTable.stagingColumns}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">Prod</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {selectedTable.prodColumns}
                </div>
              </div>
            </div>

            {selectedTable.driftSummary && (
              <div className="p-3 rounded-lg bg-red-950/30 border border-red-500/40 text-xs font-mono text-red-200">
                {selectedTable.driftSummary}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2">
            {selectedTable.driftDetected && (
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <GitCompare className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{t.runParitySyncBtn}</span>
              </button>
            )}
            <div className="text-[10px] text-slate-500 text-center font-mono">
              Live backend registry verification
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSchemaParityView;

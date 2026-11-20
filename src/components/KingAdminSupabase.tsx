import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import type {
  AdminWallet,
  EmergencyFund,
  MemeCoin,
  PlatformEconomics,
  UserProfile,
} from '../types/launchpad';
import {
  fetchSupabaseRecords,
  fetchSupabaseSchemaSql,
  migrateFirestoreToSupabase,
  validateSupabaseConnection,
  type SupabaseHealthReport,
  type SupabaseTableKey,
} from '../services/supabaseSync';

interface KingAdminSupabaseProps {
  users: UserProfile[];
  coins: MemeCoin[];
  adminWallets: AdminWallet[];
  emergencyFunds: EmergencyFund[];
  economics: PlatformEconomics;
  onBanner: (msg: { type: 'ok' | 'err'; text: string }) => void;
  onRefresh?: () => Promise<void> | void;
}

const TABLE_TABS: Array<{ key: SupabaseTableKey; label: string }> = [
  { key: 'users', label: 'Users' },
  { key: 'coins', label: 'Meme Coins' },
  { key: 'trades', label: 'Trades' },
  { key: 'comments', label: 'Comments' },
  { key: 'holdings', label: 'Holdings' },
  { key: 'perp_positions', label: 'Perps' },
  { key: 'reward_claims', label: 'Claims' },
  { key: 'admin_wallets', label: 'Vaults' },
  { key: 'emergency_funds', label: 'Emergency' },
  { key: 'admins', label: 'Admins' },
  { key: 'audit_logs', label: 'Audit Logs' },
  { key: 'economics', label: 'Economics' },
  { key: 'wallet_snapshots', label: 'Scans' },
];

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length > 0 ? `{${keys.join(', ')}}` : '{}';
  }
  const str = String(value);
  if (str.length > 42 && !str.includes(' ')) {
    return `${str.slice(0, 18)}…${str.slice(-8)}`;
  }
  return str.length > 60 ? `${str.slice(0, 57)}…` : str;
}

export function KingAdminSupabase({
  users,
  coins,
  adminWallets,
  emergencyFunds,
  onBanner,
  onRefresh,
}: KingAdminSupabaseProps) {
  const [schemaSql, setSchemaSql] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const [health, setHealth] = useState<SupabaseHealthReport | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [activeTable, setActiveTable] = useState<SupabaseTableKey>('users');
  const [tableName, setTableName] = useState('chainscope_users');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);

  const runHealthValidation = useCallback(async (showBanner = false) => {
    setCheckingHealth(true);
    try {
      const report = await validateSupabaseConnection();
      setHealth(report);
      if (showBanner) {
        if (report.allTablesReady) {
          onBanner({
            type: 'ok',
            text: `Supabase connected (${report.urlHost || 'configured'}) — all ${report.readyCount}/${report.totalTables} tables verified.`,
          });
        } else {
          onBanner({
            type: 'err',
            text: report.error || `Supabase check: ${report.readyCount}/${report.totalTables} tables ready.`,
          });
        }
      }
    } catch (err) {
      if (showBanner) {
        onBanner({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to reach /api/supabase/health',
        });
      }
    } finally {
      setCheckingHealth(false);
    }
  }, [onBanner]);

  useEffect(() => {
    fetchSupabaseSchemaSql()
      .then((sql) => setSchemaSql(sql))
      .catch(() => {});
    void runHealthValidation(false);
  }, [runHealthValidation]);

  const loadTable = useCallback(async (tableKey: SupabaseTableKey) => {
    setLoadingRows(true);
    setTableError(null);
    try {
      const res = await fetchSupabaseRecords(tableKey);
      setTableName(res.table);
      setRows(res.rows);
    } catch (err) {
      setRows([]);
      setTableError(err instanceof Error ? err.message : 'Unable to query Supabase');
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void loadTable(activeTable);
  }, [activeTable, loadTable]);

  const handleCopySql = async () => {
    if (!schemaSql) return;
    await navigator.clipboard.writeText(schemaSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1800);
  };

  const handleDownloadSql = () => {
    if (!schemaSql) return;
    const blob = new Blob([schemaSql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chainscope-supabase-schema.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMigrateFromFirestore = async () => {
    setMigrating(true);
    try {
      const res = await migrateFirestoreToSupabase();
      onBanner({
        type: 'ok',
        text: `Imported legacy Firestore records to Supabase: ${res.counts.users} users, ${res.counts.coins} coins, ${res.counts.trades} trades, ${res.counts.holdings} holdings, ${res.counts.adminWallets} vaults.`,
      });
      await onRefresh?.();
      void loadTable(activeTable);
      void runHealthValidation(false);
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Legacy Firestore migration failed',
      });
    } finally {
      setMigrating(false);
    }
  };

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6">
      {/* Live Supabase Connection Validation Panel */}
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                health?.allTablesReady
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Live Supabase Connection & Schema Validation</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {health
                  ? health.allTablesReady
                    ? `Connected to ${health.urlHost} (${health.keyMode}) · ${health.readyCount}/${health.totalTables} tables ready`
                    : health.configured
                    ? `Connected to ${health.urlHost || 'Supabase'} · ${health.readyCount}/${health.totalTables} tables ready`
                    : health.error || 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured in AI Studio Secrets.'
                  : 'Checking live PostgreSQL tables…'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void runHealthValidation(true)}
            disabled={checkingHealth}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
          >
            {checkingHealth ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Validate Connection & 13 Tables
          </button>
        </div>

        {health && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
            {health.tables.map((t) => (
              <div
                key={t.key}
                className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                  t.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-semibold truncate">
                    {t.table.replace('chainscope_', '')}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {t.ok ? `${t.count} rows` : 'Missing / Error'}
                  </div>
                </div>
                {t.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Row: Primary DB Overview + Legacy Importer + Schema SQL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-5 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Supabase PostgreSQL Primary Database</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                All Launchpad trades, Perps, Rewards, Wallets, and KingAdmin records read and write
                directly to Supabase PostgreSQL via{' '}
                <code className="font-mono text-slate-700 dark:text-slate-300">/api/db/*</code>.
                Ensure <code className="font-mono text-slate-700 dark:text-slate-300">SUPABASE_URL</code>{' '}
                and{' '}
                <code className="font-mono text-slate-700 dark:text-slate-300">
                  SUPABASE_SERVICE_ROLE_KEY
                </code>{' '}
                are set in AI Studio Secrets and run the schema SQL.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
              <div className="text-slate-500">PostgreSQL Users</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {users.length}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
              <div className="text-slate-500">PostgreSQL Coins</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {coins.length}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
              <div className="text-slate-500">Admin Vaults</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {adminWallets.length}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
              <div className="text-slate-500">Emergency Funds</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {emergencyFunds.length}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleMigrateFromFirestore()}
            disabled={migrating}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            {migrating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            {migrating ? 'Migrating Legacy Data…' : 'Migrate Legacy Firestore → Supabase'}
          </button>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">PostgreSQL Schema (supabase/schema.sql)</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Paste into Supabase Dashboard → SQL Editor to provision all 13 RLS-enabled tables.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopySql()}
                disabled={!schemaSql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
              >
                {copiedSql ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedSql ? 'Copied' : 'Copy SQL'}
              </button>
              <button
                type="button"
                onClick={handleDownloadSql}
                disabled={!schemaSql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download .sql
              </button>
            </div>
          </div>

          <pre className="p-4 max-h-[260px] overflow-auto bg-slate-950 text-slate-200 font-mono text-[11px] leading-relaxed">
            {schemaSql || 'Loading supabase/schema.sql…'}
          </pre>
        </div>
      </div>

      {/* Bottom: Supabase PostgreSQL Table Explorer */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              Supabase Table Explorer{' '}
              <span className="font-mono text-xs text-slate-500 font-normal">({tableName})</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live PostgreSQL rows queried server-side via /api/supabase/records/{activeTable}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
              {TABLE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTable(tab.key)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    activeTable === tab.key
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void loadTable(activeTable)}
              disabled={loadingRows}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {tableError ? (
          <div className="p-8 text-center text-xs text-amber-600 dark:text-amber-400">
            {tableError}
          </div>
        ) : loadingRows ? (
          <div className="p-10 flex items-center justify-center text-xs text-slate-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Querying {tableName}…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No rows in <code className="font-mono">{tableName}</code> yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#0B0F17]">
                  {columns.map((col) => (
                    <th key={col} className="py-2.5 px-4 font-mono whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((row, idx) => (
                  <tr
                    key={String(row.id || row.uid || idx)}
                    className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-4 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap"
                      >
                        {formatCellValue(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

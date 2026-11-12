import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DigitalTwinSnapshot,
  FinanceAccount,
  FinanceBudget,
  FinanceGoal,
  FinanceHolding,
  FinanceLiability,
  FinanceTransaction,
  IngestionChannel,
  RadarOpportunitiesResponse,
  SmartSyncBatchResponse,
  TableHealthEntry,
  financeApi,
  subscribeFinanceStream,
} from '../../core/api/finance';
import { encryptClientEnvelope, maskDeviceAlertAtEdge } from '../../core/security/financeVault';
import { usePrivacyPermissions } from '../../core/permissions/usePrivacyPermissions';

export type RealAlertInput = {
  source: 'android_notification' | 'ios_shortcut' | 'email_forward';
  text: string;
  accountHint?: string;
};

type FinanceContextValue = {
  loading: boolean;
  refreshing: boolean;
  sseConnected: boolean;
  errorMsg: string | null;
  setErrorMsg: (msg: string | null) => void;
  privacyMasked: boolean;
  togglePrivacyMask: () => void;
  twin: DigitalTwinSnapshot | null;
  radar: RadarOpportunitiesResponse | null;
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[];
  channels: IngestionChannel[];
  goals: FinanceGoal[];
  holdings: FinanceHolding[];
  liabilities: FinanceLiability[];
  budgets: FinanceBudget[];
  tableHealth: TableHealthEntry[];
  smartSyncing: boolean;
  smartSyncResult: SmartSyncBatchResponse | null;
  completeness: { dimensions: Array<{ label: string; done: boolean }>; pct: number };
  refresh: () => Promise<void>;
  syncUserAlerts: (alerts: RealAlertInput[]) => Promise<SmartSyncBatchResponse | null>;
};

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [privacyMasked, setPrivacyMasked] = useState(false);

  const [twin, setTwin] = useState<DigitalTwinSnapshot | null>(null);
  const [radar, setRadar] = useState<RadarOpportunitiesResponse | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [channels, setChannels] = useState<IngestionChannel[]>([]);
  const [goals, setGoals] = useState<FinanceGoal[]>([]);
  const [holdings, setHoldings] = useState<FinanceHolding[]>([]);
  const [liabilities, setLiabilities] = useState<FinanceLiability[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [tableHealth, setTableHealth] = useState<TableHealthEntry[]>([]);

  const [smartSyncing, setSmartSyncing] = useState(false);
  const [smartSyncResult, setSmartSyncResult] = useState<SmartSyncBatchResponse | null>(null);

  const loadAll = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [twinRes, radarRes, acctRes, txnRes, chanRes, goalsRes, holdRes, liabRes, budRes, thRes] =
        await Promise.all([
          financeApi.digitalTwin(),
          financeApi.radarOpportunities(),
          financeApi.accounts(),
          financeApi.transactions(25),
          financeApi.channels(),
          financeApi.goals(),
          financeApi.holdings(),
          financeApi.liabilities(),
          financeApi.budgets(),
          financeApi.tableHealth(),
        ]);
      setTwin(twinRes);
      setRadar(radarRes);
      setAccounts(acctRes.accounts ?? []);
      setTransactions(txnRes.transactions ?? []);
      setChannels(chanRes.channels ?? []);
      setGoals(goalsRes.goals ?? []);
      setHoldings(holdRes.holdings ?? []);
      setLiabilities(liabRes.liabilities ?? []);
      setBudgets(budRes.budgets ?? []);
      setTableHealth(thRes.tables ?? []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Unable to connect to NEXORA Finance API');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    return subscribeFinanceStream(
      () => {
        void loadAll();
      },
      live => setSseConnected(live),
    );
  }, [loadAll]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
  }, [loadAll]);

  const syncUserAlerts = useCallback(
    async (items: RealAlertInput[]): Promise<SmartSyncBatchResponse | null> => {
      const { permissions } = usePrivacyPermissions.getState();
      if (!permissions.smsAlertIngestion) {
        setErrorMsg('Bank & UPI Alert Parsing permission is OFF. Enable it in Privacy & Access.');
        return null;
      }
      const clean = items.filter(i => i.text.trim().length > 0);
      if (clean.length === 0) {
        setErrorMsg('Paste at least one real bank, UPI, card, or salary alert to sync.');
        return null;
      }
      setSmartSyncing(true);
      setErrorMsg(null);
      try {
        const prepared = clean.map(item => {
          if (permissions.edgePiiMasking) {
            const masked = maskDeviceAlertAtEdge(item.text.trim(), item.accountHint);
            return {
              source_channel: item.source,
              raw_text: masked.scrubbedText,
              masked_account: masked.maskedAccount,
            };
          }
          return {
            source_channel: item.source,
            raw_text: item.text.trim(),
            masked_account: item.accountHint?.trim() || '',
          };
        });
        const res = await financeApi.smartSyncBatch({
          alerts: prepared,
          e2ee_envelope: permissions.edgePiiMasking
            ? encryptClientEnvelope(JSON.stringify(prepared)).ciphertext
            : undefined,
        });
        setSmartSyncResult(res);
        await loadAll();
        return res;
      } catch (err: any) {
        setErrorMsg(err?.message ?? 'Smart Alert Sync failed');
        return null;
      } finally {
        setSmartSyncing(false);
      }
    },
    [loadAll],
  );

  const completeness = useMemo(() => {
    const dimensions = [
      { label: 'Accounts', done: accounts.length > 0 },
      { label: 'Transactions', done: transactions.length > 0 },
      { label: 'Holdings', done: holdings.length > 0 || (twin?.investments_inr ?? 0) > 0 },
      { label: 'Liabilities', done: liabilities.length > 0 || (twin?.total_liabilities_inr ?? 0) > 0 },
      { label: 'Goals', done: goals.length > 0 },
    ];
    const completed = dimensions.filter(d => d.done).length;
    return { dimensions, pct: Math.round((completed / dimensions.length) * 100) };
  }, [accounts.length, goals.length, holdings.length, liabilities.length, transactions.length, twin]);

  return (
    <FinanceContext.Provider
      value={{
        loading,
        refreshing,
        sseConnected,
        errorMsg,
        setErrorMsg,
        privacyMasked,
        togglePrivacyMask: () => setPrivacyMasked(v => !v),
        twin,
        radar,
        accounts,
        transactions,
        channels,
        goals,
        holdings,
        liabilities,
        budgets,
        tableHealth,
        smartSyncing,
        smartSyncResult,
        completeness,
        refresh,
        syncUserAlerts,
      }}>
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinanceData() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinanceData must be used inside FinanceProvider');
  return ctx;
}

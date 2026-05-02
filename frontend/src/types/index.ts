export type TransactionStatus = 'staged' | 'synced' | 'excluded';

export interface PlaidItem {
  id: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  cursor: string;
  created_at: string;
  accounts: Account[];
}

export interface Account {
  id: string;
  name: string;
  plaid_item_id: string;
  plaid_account_id: string;
  actual_id: string;
  actual_server_url: string;
  actual_sync_id: string;
  created_at: string;
}

export interface PlaidAccountInfo {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
}

export interface Transaction {
  id: string;
  bank_account: string;
  actual_account_id: string;
  date: string;
  amount: number;     // cents, negative = debit
  payee: string;
  memo: string;
  cleared: boolean;
  status: TransactionStatus;
  fetched_at: string;
}

export type SyncEventType =
  | 'SYNC_STARTED'
  | 'TRANSACTIONS_FETCHED'
  | 'SYNC_COMPLETE'
  | 'SYNC_ERROR';

export interface SyncEvent {
  type: SyncEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ActualAccount {
  id: string;
  name: string;
}

export interface AppSettings {
  actual_server_url: string;
  actual_budget_id: string;
  totp_enabled: string;
  schedule_enabled?: string;
  schedule_cron?: string;
  schedule_last_run?: string;
  schedule_last_result?: string;
}

export interface AuthStatus {
  setup_required: boolean;
  has_2fa: boolean;
}

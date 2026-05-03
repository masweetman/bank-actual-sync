export type TransactionStatus = 'staged' | 'synced' | 'excluded';

export interface PlaidItem {
  id: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  cursor: string;
  created_at: string;
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

export interface Transaction {
  id: string;
  bank_account: string;      // human-readable account name, e.g. "Personal Venture"
  actual_account_id: string; // Actual Budget account UUID
  date: string;              // YYYY-MM-DD
  amount: number;            // cents, negative = debit
  payee: string;
  memo: string;
  cleared: boolean;
  pending_transaction_id: string | null; // Plaid ID of the pending tx this cleared tx was matched from
  status: TransactionStatus;
  fetched_at: string;        // ISO timestamp
}

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: string[];
  failedIds: string[];
}

export interface ActualAccount {
  id: string;
  name: string;
}

export interface SyncEvent {
  type:
    | 'SYNC_STARTED'
    | 'TRANSACTIONS_FETCHED'
    | 'SYNC_COMPLETE'
    | 'SYNC_ERROR';
  payload?: Record<string, unknown>;
  timestamp: string;
}

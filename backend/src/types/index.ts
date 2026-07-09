export type TransactionStatus = 'staged' | 'synced' | 'excluded';

export interface PlaidItem {
  id: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  cursor: string;
  status: 'good' | 'login_required';
  created_at: string;
}

export interface TellerEnrollment {
  id: string;
  enrollment_id: string;
  institution_name: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  institution: { id: string; name: string };
  name: string;
  type: string;
  subtype: string;
  status: string;
  last_four: string;
  currency: string;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  amount: string; // signed decimal string, positive = debit
  date: string;   // YYYY-MM-DD
  description: string;
  details: {
    processing_status: string;
    category: string | null;
    counterparty: { name: string | null; type: string | null } | null;
  };
  status: 'posted' | 'pending';
  type: string;
  running_balance: string | null;
}

export interface Account {
  id: string;
  name: string;
  provider: 'plaid' | 'teller';
  // Plaid fields
  plaid_item_id: string | null;
  plaid_account_id: string | null;
  // Teller fields
  teller_enrollment_id: string | null;
  teller_account_id: string | null;
  // Actual Budget
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

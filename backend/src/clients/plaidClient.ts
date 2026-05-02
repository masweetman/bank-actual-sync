import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import type { Transaction } from '../types';

function buildClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = process.env.PLAID_ENV ?? 'production';

  if (!clientId || !secret) {
    throw new Error('PLAID_CLIENT_ID and PLAID_SECRET environment variables are required');
  }

  const basePath =
    env === 'sandbox'
      ? PlaidEnvironments.sandbox
      : PlaidEnvironments.production;

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/** Lazily created — fails fast with a clear error if env vars are missing. */
let _client: PlaidApi | null = null;
function client(): PlaidApi {
  return _client ??= buildClient();
}

// ─── Link Token ───────────────────────────────────────────────────────────────

export async function createLinkToken(userId: string): Promise<string> {
  const response = await client().linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Bank Actual Sync',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return response.data.link_token;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

export interface PlaidAccountInfo {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
}

export interface ExchangeResult {
  access_token: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  accounts: PlaidAccountInfo[];
}

export async function exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
  const exchangeResponse = await client().itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = exchangeResponse.data;

  // Fetch institution info
  const itemResponse = await client().itemGet({ access_token });
  const institutionId = itemResponse.data.item.institution_id ?? '';

  let institutionName = institutionId;
  if (institutionId) {
    try {
      const instResponse = await client().institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = instResponse.data.institution.name;
    } catch {
      // non-fatal: fall back to institution_id
    }
  }

  // Fetch accounts
  const accountsResponse = await client().accountsGet({ access_token });
  const accounts: PlaidAccountInfo[] = accountsResponse.data.accounts.map(a => ({
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name ?? null,
    type: a.type as string,
    subtype: a.subtype as string | null,
    mask: a.mask ?? null,
  }));

  return { access_token, item_id, institution_id: institutionId, institution_name: institutionName, accounts };
}

// ─── Remove Item ──────────────────────────────────────────────────────────────

export async function removeItem(accessToken: string): Promise<void> {
  await client().itemRemove({ access_token: accessToken });
}

// ─── Transactions Sync ────────────────────────────────────────────────────────

export interface SyncTransactionsResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];  // transaction_ids
  nextCursor: string;
  hasMore: boolean;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;            // YYYY-MM-DD
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  amount: number;          // positive = debit, negative = credit (Plaid convention)
  pending: boolean;
  category: string[] | null;
}

/**
 * Fetches all new/modified/removed transactions since the last cursor.
 * Paginates automatically until hasMore is false.
 */
export async function syncTransactions(
  accessToken: string,
  cursor: string,
): Promise<SyncTransactionsResult> {
  const added: PlaidTransaction[]    = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[]            = [];

  let currentCursor = cursor;
  let hasMore = true;

  while (hasMore) {
    const response = await client().transactionsSync({
      access_token: accessToken,
      cursor: currentCursor || undefined,
      options: { include_personal_finance_category: false },
    });

    const data = response.data;

    for (const t of data.added) {
      added.push(mapPlaidTransaction(t));
    }
    for (const t of data.modified) {
      modified.push(mapPlaidTransaction(t));
    }
    for (const t of data.removed) {
      removed.push(t.transaction_id);
    }

    currentCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return { added, modified, removed, nextCursor: currentCursor, hasMore: false };
}

function mapPlaidTransaction(t: {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
  category?: string[] | null;
}): PlaidTransaction {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    date: t.authorized_date ?? t.date,
    authorized_date: t.authorized_date ?? null,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    amount: t.amount,
    pending: t.pending,
    category: t.category ?? null,
  };
}

// ─── Transaction Mapping ─────────────────────────────────────────────────────

/**
 * Converts a Plaid transaction to our internal Transaction format.
 *
 * Plaid amount convention: positive = debit (money leaving account),
 * negative = credit (money entering account). We store as cents with the
 * same sign convention (negative = debit).
 */
export function toInternalTransaction(
  plaidTx: PlaidTransaction,
  accountName: string,
  actualAccountId: string,
): Transaction {
  // Plaid positive=debit → our negative=debit. Multiply by -100 to convert dollars → cents and flip sign.
  const amountCents = Math.round(plaidTx.amount * -100);

  return {
    id: plaidTx.transaction_id,
    bank_account: accountName,
    actual_account_id: actualAccountId,
    date: plaidTx.date,
    amount: amountCents,
    payee: plaidTx.merchant_name ?? plaidTx.name,
    memo: '',
    cleared: !plaidTx.pending,
    status: 'staged',
    fetched_at: new Date().toISOString(),
  };
}

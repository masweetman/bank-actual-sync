import https from 'https';
import type { TellerAccount, TellerTransaction, Transaction } from '../types';

const TELLER_API_HOST = 'api.teller.io';

// ─── mTLS Agent ───────────────────────────────────────────────────────────────

/**
 * Builds an https.Agent configured for Teller's mutual TLS requirement.
 * Pass empty strings for cert/key when using the sandbox environment
 * (sandbox does not enforce client certificates).
 */
export function buildTellerAgent(cert: string, key: string): https.Agent {
  if (cert && key) {
    return new https.Agent({ cert, key });
  }
  // Sandbox: no client cert needed
  return new https.Agent();
}

// ─── Authenticated fetch ──────────────────────────────────────────────────────

function tellerFetch<T>(
  path: string,
  accessToken: string,
  agent: https.Agent,
  params?: Record<string, string>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const query = params
      ? '?' + new URLSearchParams(params).toString()
      : '';
    const credentials = Buffer.from(`${accessToken}:`).toString('base64');

    const options: https.RequestOptions = {
      hostname: TELLER_API_HOST,
      path: path + query,
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
      agent,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Teller API ${path} returned ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(new Error(`Failed to parse Teller response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function listTellerAccounts(
  accessToken: string,
  agent: https.Agent,
): Promise<TellerAccount[]> {
  return tellerFetch<TellerAccount[]>('/accounts', accessToken, agent);
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * Fetches transactions for a single account using a date range.
 * Teller recommendation: expand start_date 10 days before last sync to catch
 * pending→posted transitions that shift dates.
 */
export async function listTellerTransactions(
  accessToken: string,
  accountId: string,
  startDate: string,
  agent: https.Agent,
): Promise<TellerTransaction[]> {
  const today = new Date().toISOString().slice(0, 10);
  return tellerFetch<TellerTransaction[]>(
    `/accounts/${accountId}/transactions`,
    accessToken,
    agent,
    { start_date: startDate, end_date: today },
  );
}

// ─── Transaction mapping ──────────────────────────────────────────────────────

/**
 * Converts a Teller transaction to our internal Transaction format.
 *
 * Teller amount convention: positive string = debit (money leaving account),
 * negative string = credit. We store as cents with negative = debit.
 * So multiply by -100 (same as Plaid convention).
 */
export function toInternalTellerTransaction(
  tx: TellerTransaction,
  accountName: string,
  actualAccountId: string,
): Transaction {
  const amountCents = Math.round(parseFloat(tx.amount) * -100);

  return {
    id: `teller_${tx.id}`,
    bank_account: accountName,
    actual_account_id: actualAccountId,
    date: tx.date,
    amount: amountCents,
    payee: tx.details?.counterparty?.name ?? tx.description,
    memo: tx.description,
    cleared: tx.status === 'posted',
    pending_transaction_id: null,
    status: 'staged',
    fetched_at: new Date().toISOString(),
  };
}

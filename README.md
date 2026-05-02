# Bank Actual Sync

Syncs transactions from bank accounts (via [Plaid](https://plaid.com)) into [Actual Budget](https://actualbudget.org).

## Architecture

| Service | Description |
|---|---|
| `sync-backend` | Node.js/Express API, SQLite database, Plaid integration |
| `sync-ui` | React SPA served by Nginx, proxies API calls to backend |

The frontend is only bound to `127.0.0.1:3081`. It is intended to sit behind **Nginx Proxy Manager** (or a similar reverse proxy) for TLS termination.

Both services join an external Docker network (`budget-net`) so they can reach your existing Actual Budget container.

---

## Prerequisites

- Docker with Portainer installed
- An existing **Actual Budget** container running on the same Docker host
- A **Plaid** developer account — [get credentials here](https://dashboard.plaid.com/)

---

## Step 1 — Create the shared Docker network

Both this stack and your Actual Budget container must be on the same Docker network. Create it once if it does not already exist:

```bash
docker network create budget-net
```

Then connect your Actual Budget container to it:

```bash
docker network connect budget-net <actual-budget-container-name>
```

---

## Step 2 — Add the stack in Portainer

1. In Portainer, go to **Stacks → Add stack**.
2. Name the stack (e.g. `bank-actual-sync`).
3. Choose **Repository**, enter your git repo URL, and set the compose file path to `docker-compose.yml`.
4. Portainer will clone the repo and build the images automatically on deploy.

---

## Step 3 — Set environment variables

In the Portainer stack editor, scroll to **Environment variables** and add the following:

| Variable | Required | Description |
|---|---|---|
| `PLAID_CLIENT_ID` | **Yes** | Your Plaid Client ID |
| `PLAID_SECRET` | **Yes** | Your Plaid Secret key |
| `ENCRYPTION_KEY` | **Yes** | 64-character hex string used to encrypt secrets in the database. Generate one with the command below. |
| `PLAID_ENV` | No | `production` (default) or `sandbox` for test data |

### Generate an ENCRYPTION_KEY

```bash
openssl rand -hex 32
```

> **Important:** Keep `ENCRYPTION_KEY` safe and backed up. If it is lost, all encrypted data in the database (Plaid tokens, Actual password) becomes unreadable.

---

## Step 4 — Deploy

Click **Deploy the stack**. Portainer will clone the repo, build both images, and start the containers.

To check logs:

```
Portainer → Stacks → bank-actual-sync → Logs (on each container)
```

---

## Step 5 — Set up a reverse proxy (optional but recommended)

The UI listens on `127.0.0.1:3081`. To access it from your network or the internet, add a proxy host in **Nginx Proxy Manager**:

- **Forward hostname / IP:** `localhost`
- **Forward port:** `3081`
- Enable **SSL** with a Let's Encrypt certificate for HTTPS access.

---

## Step 6 — First-time setup

1. Open the app in your browser.
2. You will be prompted to **create an admin password** on first launch.
3. Go to **Settings** to:
   - Connect your bank accounts via the **Plaid Link** flow.
   - Enter your **Actual Budget** server URL, budget ID, and password.
   - Map each Plaid account to an account in Actual Budget.
4. Return to the **Dashboard** and click **Sync** to pull transactions.
5. Review the staged transactions, then click **Sync to Actual** to import them.

---

## Data persistence

App data (SQLite database, Actual budget cache) is stored in a named Docker volume:

```
sync-data  →  /app/data  (inside the container)
```

To back up your data:

```bash
docker run --rm \
  -v sync-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/sync-data-backup.tar.gz -C /data .
```

---

## Updating

To pick up code changes, push your updates to the git repo, then in Portainer go to **Stacks → bank-actual-sync** and click **Pull and redeploy**.

Portainer will pull the latest code, rebuild the images, and restart the containers. The `sync-data` volume is preserved.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend fails to start | Verify `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `ENCRYPTION_KEY` are set in the stack environment |
| UI shows "cannot connect" | Confirm both containers are on `budget-net` and backend is healthy |
| Actual Budget sync fails | Check the Actual server URL and budget ID in Settings; ensure the Actual container is on `budget-net` |
| Plaid Link fails | Confirm `PLAID_ENV` matches the environment your Plaid credentials belong to |

# Putting Rejista on a server (VPS)

One script installs everything and is also how you update later. This guide walks through it start to finish.

## What you need

| | |
|---|---|
| **Server** | A VPS running Ubuntu 22.04 or 24.04, or Debian 12. Provide enough memory for builds (or configure swap yourself); 2 CPU cores and 40 GB of disk is a comfortable start. |
| **Access** | SSH access as `root`, or a user who can run `sudo`. |
| **Domain** | A domain name. The installer suggests `skultab.com`; type another when it asks. |
| **Email** | An address for certificate expiry notices from Let's Encrypt. |

## 1. Point the domain at the server

At your domain registrar, create an **A record** for the domain (for example `skultab.com`) with the server's public IP address. Do this first: the HTTPS certificate step fails if the domain does not reach the server yet.

Check it from your own computer. It should print the server's IP:

```bash
dig +short skultab.com
```

## 2. Get the code onto the server

Copy the whole project folder to the server. From your computer, in the project folder:

```bash
rsync -az --exclude node_modules --exclude dist --exclude .git --exclude '.env*' ./ root@YOUR_SERVER_IP:/root/rejista/
```

If the project is in a git repository the server can reach, cloning works too. Make sure the `deploy/` folder is committed first:

```bash
git clone YOUR_REPOSITORY_URL /root/rejista
```

## 3. Run the installer

**Shared-server safety:** Node 24+ and pnpm 10.32.1 are reused when compatible;
otherwise the installer downloads private copies under `/opt/rejista-toolchain`.
It checks the Node archive against the official release checksum and does not
replace system Node or global pnpm. Private runtimes are passed explicitly to
builds and the API service.

Other required tools are: running nginx, curl, tar, sha256sum, rsync, openssl, sudo, Python 3, util-linux
(flock), iproute2 (ss), and PostgreSQL client tools. For automatic certificate
issuance, certbot is also required. The installer no longer updates shared
packages/runtimes, creates swap, changes UFW, or removes nginx's default site.

For an existing database, prefer a root-owned mode-600 file containing only its
connection URL, and pass `--db-url-file /root/rejista-db-url` rather than putting
a password in shell history. The database must be empty on first installation
and dedicated to this application. Updates verify Rejista's baseline migration.
The file is read without shell evaluation.

For a working deployment created by the older installer, use `--adopt-existing`
once after checking that its Rejista account, release folders, settings and
service really belong to this app. The installer validates those identifiers
before marking it managed; conflicting or incomplete installations are rejected.

On a **fresh server without PostgreSQL**, explicitly request a new database server:

```bash
cd /root/rejista && sudo ./deploy/install.sh --install-postgres
```

On the first run it asks a few questions. Press Enter to keep the answer shown in brackets.

| Question | Default | Notes |
|---|---|---|
| Domain | `skultab.com` | Type your own, such as `app.myschool.co.ke`. |
| Set up HTTPS? | yes | Needed for M-Pesa and bank notifications. |
| Your email | none | Only used by Let's Encrypt. |
| Product name | `Rejista` | Shown on screens, emails and PDFs. Can be changed later. |
| Hosted or standalone | hosted | Hosted is many schools with sign-up and subscriptions; standalone is one school. |

It then shows a summary, warns you if the domain does not point at this server yet, and asks you to confirm.

To skip the questions (for example in a script):

```bash
sudo ./deploy/install.sh --domain skultab.com --email you@example.com --yes --install-postgres
```

The install takes five to ten minutes. When it finishes it prints the site address and a **setup token**.

## 4. Create the platform owner

Open the site in a browser. The first screen asks for the setup token the installer printed (it is also saved as `SETUP_TOKEN` in the settings file). Enter it, then create your school and your own account. That account is the platform owner.

## 5. Finish the settings

Everything secret lives in one file outside the code:

```
/etc/rejista/rejista.env
```

Edit it with `sudo nano /etc/rejista/rejista.env`. The installer fills in the database, the secrets and the domain. Things you will probably add:

| Setting | What it is for |
|---|---|
| `ANTHROPIC_API_KEY` | Lets the support assistant answer questions from the knowledge base. Without it, only the starter questions get answers. |
| `GOOGLE_SITE_VERIFICATION` | Proves the site is yours in Google Search Console. |
| `KCB_PUBLIC_KEY` | Verifies KCB payment notifications, if you use KCB. |
| `APP_NAME` | The product name, if you want to change it later. |

After changing the file, restart the system so it picks the change up:

```bash
sudo systemctl restart rejista-api
```

`APP_NAME` and `GOOGLE_SITE_VERIFICATION` are the exception: they are built into the web pages, so after changing
either of them run the installer again instead:

```bash
cd /root/rejista && sudo ./deploy/install.sh
```

M-Pesa, SunPay, SMS, WhatsApp and email (Brevo) keys are **not** in this file. They are entered inside the system, in the platform console's Settings.

**Back this file up somewhere safe.** `ENCRYPTION_KEY` in it protects saved bank and payment credentials; if it is lost they cannot be read again.

## Updating

Copy the new code over the old folder (step 2), then run the same command:

```bash
cd /root/rejista && sudo ./deploy/install.sh
```

Nothing is asked the second time. It builds the new version beside the old one, applies database changes, switches over, and switches back by itself if the new version fails its health check.

To go back to the previous version by hand:

```bash
sudo ./deploy/rollback.sh --schema-compatible
```

Database changes are not undone by a rollback.

## Where things are

| Path | What |
|---|---|
| `/opt/rejista/current` | The version that is live |
| `/opt/rejista/releases/` | Unique release folders, retained until explicitly cleaned up |
| `/etc/rejista/rejista.env` | Settings and secrets |
| `/var/lib/rejista/storage` | Uploaded files, generated documents and nightly database backups |

## Everyday commands

Watch the live log:

```bash
journalctl -u rejista-api -f
```

Restart the system:

```bash
sudo systemctl restart rejista-api
```

Check it is running:

```bash
systemctl status rejista-api
```

## If something goes wrong

| Problem | What to check |
|---|---|
| "Certificate request failed" | Check DNS and port 80, then inspect the recovery snapshot and deployment marker before retrying. If migrations started, resolve database/code compatibility first. |
| The site does not open | `systemctl status nginx` and `systemctl status rejista-api`. The installer's last lines say whether the site was reachable. |
| "The API did not start" | `journalctl -u rejista-api -e` shows the reason, usually a missing or mistyped setting. |
| Out of memory during the build | Provide enough RAM or configure swap explicitly. The installer never creates or formats swap files. |
| Lost the setup token | It is `SETUP_TOKEN` in `/etc/rejista/rejista.env`. |

## Existing PostgreSQL / shared VPS

On an existing PostgreSQL server, run the single installer:

```bash
bash deploy/install.sh
```

Run as root. The installer reuses its saved settings or `/root/rejista-db-url`.
If neither exists, it calls its database setup helper automatically and continues
installation. There is no separate database command to run.
The helper uses the existing local `postgres` account through
its Unix socket and defaults to port 5432. For a nonstandard PostgreSQL port/socket,
the helper can still be invoked explicitly with `--port` / `--socket-dir`, or
supply `--db-url-file` to the installer for an existing connection.
It creates only the `rejista` role and database, refuses existing names, leaves
PostgreSQL packages/services/authentication rules alone, and verifies TCP access.
Credentials are saved mode 600 without printing the password. If creation stops
partway through, it retains a root-only pending credentials file and log; do not
delete databases or reset an existing role to retry.

Use `--db-url` with a **dedicated Rejista database and account** provisioned by your
database administrator. Do not point it at another application's database: Rejista
still applies its own schema migrations to the database you select.

The installer checks connectivity and verifies that `pg_dump` can back up the server.
Install compatible `psql` and `pg_dump` client tools yourself if they are missing.
It does not install, upgrade, enable or restart PostgreSQL in this mode, nor does it
change database users' passwords. Updates reuse the saved connection automatically.

`--install-postgres` is refused if PostgreSQL packages, binaries, configuration/data
files, running processes or a listener on port 5432 are detected. It is also refused
on updates and cannot be combined with `--db-url`. After an interrupted first setup,
use the existing database credentials rather than trying to install another server.
Role/database name collisions stop setup; they are never overwritten.

No PostgreSQL APT repositories are added or rewritten. New installations use the
packages available from your configured repositories. An existing broken repository
(such as an obsolete `focal-pgdg` entry) must be repaired by the server administrator
before APT can run; this installer does not silently change shared repository settings.

## What the installer sets up

- Compatible Node.js/pnpm or private copies; running nginx is required; PostgreSQL installation is opt-in
- A `rejista` system user that runs the system with no shell and no access outside its own folders
- A new database with a generated password only for an explicitly requested new PostgreSQL installation
- The API as a service that restarts by itself and starts on boot
- nginx in front, serving the web app and passing `/api/` to the API
- A Let's Encrypt certificate that renews itself
- Firewall and shared certificate-renewal hooks are left unchanged

## Port selection and recovery

The API tries its saved port (8080 on first install), then the next port if another
app owns it. Rejista ownership requires its service cgroup, system account and
release working directory; a process name is insufficient. Only that service is
stopped to reuse a port. The selected port is saved and used by nginx. The API
binds to loopback on the VPS, not the public network interface.

Deployment and rollback take the same exclusive lock. Release directories have
unique names and are not automatically deleted (`--keep` is retained only for
command compatibility). Root owns the installer helper and release links.

Before migrations, a private full database dump is saved under
`/etc/rejista/backups/` and read back with pg_restore (not restored into a live DB).
This checks the archive, not a complete disaster-recovery restore rehearsal.
Rejista is stopped during backup/migration; other applications are not stopped.

Configuration snapshots are root-only under `/var/tmp/rejista-recovery.*`.
The path is recorded in `/etc/rejista/deploy-in-progress`. On failure, configuration
and the previous code link are restored. If migrations began, the API stays stopped:
an administrator must inspect schema compatibility or deliberately restore the
backup. A dump is never automatically restored over a live database. Proposed
settings (including newly generated credentials) remain in the protected snapshot.
Do not remove the in-progress marker until recovery is complete. A hard kill or
power loss also leaves this marker, preventing a blind retry.

Manual code rollback requires `--schema-compatible` after verifying the target
code supports the current schema. It does not undo database changes.

## Local safety checks

Run from the repository root:

```bash
bash -n deploy/*.sh
python3 deploy/test-postgres-checks.py
python3 deploy/test-host-safety.py
python3 deploy/test-installer-flow.py
python3 deploy/test-create-database.py
python3 deploy/test-postgres-client.py
python3 deploy/test-runtime.py
```

The flow suite executes the installer's control flow in a temporary filesystem
with simulated system services and database commands. It covers first setup,
updates, and failures during build, backup, migration, service restart and nginx
configuration. File restoration tests use real files, symlinks and permissions.
It never installs packages or contacts a VPS. These tests do not exercise real
systemd/nginx/PostgreSQL integration.

The PostgreSQL client suite additionally starts a separate temporary PostgreSQL
cluster (when local binaries are available), with a private Unix socket and no
TCP listener. It checks the real connection, backup and restore path without
using the workspace or VPS database.

Settings are replaced atomically. Recovery disables the normal error trap so
one failed recovery operation does not prevent the remaining attempts; failures
are reported as **RECOVERY INCOMPLETE**, not as successful restoration.

## More detail

[docs/self-hosting.md](../docs/self-hosting.md) is the reference: every installer option, what is installed where,
backups, and suggestions for running it day to day.

## Not covered

- **`www.` addresses.** The site answers on the exact domain you give. To use `www.skultab.com` as well, add its own A record and ask for it to be added to the nginx site.
- **Off-server backups.** Nightly database backups are written to `/var/lib/rejista/storage` on the same server. Copy that folder somewhere else regularly; a lost server otherwise takes its backups with it.
- **Email sending.** Password-reset and other emails need a Brevo key entered in the platform console.

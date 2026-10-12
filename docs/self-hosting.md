# Hosting Rejista on your own server

`deploy/install.sh` sets up a fresh Ubuntu or Debian server and updates it later. One command does everything:
packages, database, settings, build, migrations, background jobs, nginx, the SSL certificate and the firewall.

## What you need

- A server running **Ubuntu 24.04** (22.04 and Debian 12 also work), with at least 2 vCPU, 4 GB RAM and 40 GB disk.
  On servers with under 3 GB of RAM the installer adds a 2 GB swap file so builds don't run out of memory.
- A **domain or subdomain**, e.g. `app.rejista.co.ke`, with an **A record pointing at the server's public IP**. Set
  this before installing: Let's Encrypt checks it when issuing the certificate.
- Ports **80 and 443** open to the internet. Banks and payment providers only call HTTPS addresses.
- SSH access as a user with `sudo`.

## First install

```bash
# on the server
git clone <your-repo-url> rejista && cd rejista      # or copy the project folder over with rsync/scp
sudo ./deploy/install.sh --domain app.rejista.co.ke --email you@example.com
```

When it finishes it prints the site address and a **setup token**. Open the site and use the token on the first-time
setup screen to create the platform owner account.

Options: `--db-url postgresql://…` to use an existing database instead of a local one, `--mode standalone` for a
single-school install, `--no-ssl` for a plain-HTTP test server, `--no-firewall` to leave the firewall alone, `--keep N`
to keep a different number of releases (default 5).

## What it sets up

| Where | What |
|---|---|
| `/etc/rejista/rejista.env` | All settings and secrets (owner root, group rejista, mode 0640). Outside every build folder. |
| `/opt/rejista/releases/<time>/` | One folder per build: code, dependencies, the API bundle and the web app. |
| `/opt/rejista/current` | Link to the live release. nginx and the API service both run from it. |
| `/var/lib/rejista/storage` | Uploaded logos, generated documents and the nightly database backups. Kept across releases. |
| `rejista-api` (systemd) | The API on `127.0.0.1:8080`, restarted automatically, hardened (read-only code, writes only to `/var/lib/rejista`). |
| nginx | Serves the web app, sends `/api/` to the API, redirects HTTP to HTTPS, adds security headers and caching. |
| Let's Encrypt | Certificate for the domain, renewed automatically by `certbot.timer`, which reloads nginx afterwards. |
| PostgreSQL 16 | Local database `rejista`, reachable only from the server itself. |
| ufw | Only SSH, HTTP and HTTPS are open. |
| pg-boss schedules | Payments, messages, receipts, reconciliation and the 03:00 database backup (Africa/Nairobi time). |

The settings file is created once, from `deploy/rejista.env.example`, with freshly generated `SESSION_SECRET`,
`ENCRYPTION_KEY`, `SETUP_TOKEN` and database password. Later runs never overwrite it.

**Back up `/etc/rejista/rejista.env` somewhere safe.** If `ENCRYPTION_KEY` is lost, the bank and payment credentials
saved in Rejista can't be read again.

## Updating

Bring the new code into the project folder, then run the installer again:

```bash
cd rejista && git pull
sudo ./deploy/install.sh
```

Each update builds a new release beside the live one, applies migrations, then switches over and restarts the API.
If the new release fails its health check, the installer switches back to the previous release automatically.

## Rolling back

```bash
sudo ./deploy/rollback.sh                    # previous release
sudo ./deploy/rollback.sh 20261009-143000    # a specific release from /opt/rejista/releases
```

Database migrations are not undone. Roll back only to a release built against the same database schema.

## Settings you'll add later

Edit `/etc/rejista/rejista.env` (one `KEY=value` per line, no quotes), then `sudo systemctl restart rejista-api`:

- `KCB_PUBLIC_KEY`: KCB's signing key, once KCB sends it. Paste the base64 text between the BEGIN/END lines on one line.
- `LICENCE_SIGNING_KEY`: hosted server only, for issuing standalone licences (`licence:keygen`).
- `PROVIDER_*`: the service provider printed on bank request letters.

`APP_BASE_URL` and `SITE_URL` are set from `--domain`. If the domain changes, update both, then re-run the installer
(`SITE_URL` is used when the web app is built).

## Day to day

```bash
journalctl -u rejista-api -f                 # API logs
systemctl status rejista-api                 # is it running
sudo -u rejista /opt/rejista/bin/rejista-env psql "$DATABASE_URL"   # database shell with the server's settings
```

The health check is `https://<domain>/api/healthz`. Point an uptime monitor at it (UptimeRobot, Better Stack and
similar services have free plans).

## Backups

Rejista makes a `pg_dump` backup every night at 03:00 into `/var/lib/rejista/storage`. That folder is on the same disk
as the database, so **copy it off the server** as well, for example with a nightly `rclone` or `restic` job to cloud
storage, together with `/etc/rejista/rejista.env`. Your host's disk snapshots are a good extra layer.

## Suggestions

- Use a separate managed PostgreSQL (`--db-url`) once you have many schools: backups and failover become the host's job.
- Turn on automatic security updates: `sudo apt install unattended-upgrades`.
- Use SSH keys only, and consider `fail2ban`.
- Run a staging server (`staging.<domain>`) with the same installer and test updates there first. Banks such as KCB
  need a public HTTPS endpoint for UAT, and a staging server gives them one without touching live data.

# Putting Rejista on a server (VPS)

One script installs everything and is also how you update later. This guide walks through it start to finish.

## What you need

| | |
|---|---|
| **Server** | A VPS running Ubuntu 22.04 or 24.04, or Debian 12. 2 GB of memory is enough (the script adds swap on small servers); 2 CPU cores and 40 GB of disk is a comfortable start. |
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

On the server:

```bash
cd /root/rejista && sudo ./deploy/install.sh
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
sudo ./deploy/install.sh --domain skultab.com --email you@example.com --yes
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

After changing the file, run the installer again so the change takes effect:

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
sudo ./deploy/rollback.sh
```

Database changes are not undone by a rollback.

## Where things are

| Path | What |
|---|---|
| `/opt/rejista/current` | The version that is live |
| `/opt/rejista/releases/` | The last five versions, kept for rollback |
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
| "Certificate request failed" | The domain's A record does not point at this server yet, or port 80 is blocked by the provider's firewall. Fix it and run the installer again. |
| The site does not open | `systemctl status nginx` and `systemctl status rejista-api`. The installer's last lines say whether the site was reachable. |
| "The API did not start" | `journalctl -u rejista-api -e` shows the reason, usually a missing or mistyped setting. |
| Out of memory during the build | Use a server with at least 2 GB of memory. The script adds a 2 GB swap file when there is less than 3 GB and no swap. |
| Lost the setup token | It is `SETUP_TOKEN` in `/etc/rejista/rejista.env`. |

## What the installer sets up

- Node.js 24, pnpm, PostgreSQL 16, nginx and certbot
- A `rejista` system user that runs the system with no shell and no access outside its own folders
- The database, with a generated password
- The API as a service that restarts by itself and starts on boot
- nginx in front, serving the web app and passing `/api/` to the API
- A Let's Encrypt certificate that renews itself
- A firewall that leaves only SSH, HTTP and HTTPS open

## Not covered

- **`www.` addresses.** The site answers on the exact domain you give. To use `www.skultab.com` as well, add its own A record and ask for it to be added to the nginx site.
- **Off-server backups.** Nightly database backups are written to `/var/lib/rejista/storage` on the same server. Copy that folder somewhere else regularly; a lost server otherwise takes its backups with it.
- **Email sending.** Password-reset and other emails need a Brevo key entered in the platform console.

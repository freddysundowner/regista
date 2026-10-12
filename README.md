# regista

School management for Kenyan schools: learners, classwork, fees, M-Pesa and bank collections.

## Hosting

To put Rejista on your own Ubuntu or Debian server with nginx and HTTPS, run the installer from the project folder
on the server. It asks for the domain (`skultab.com` unless you type another), your email and the product name:

```bash
sudo ./deploy/install.sh
```

- [deploy/README.md](deploy/README.md): step by step, from pointing the domain to the first sign-in.
- [docs/self-hosting.md](docs/self-hosting.md): reference for what gets installed, options, backups and day-to-day commands.

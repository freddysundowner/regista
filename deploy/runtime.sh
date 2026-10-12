#!/usr/bin/env bash
# Private runtimes only; never change /usr/bin, global npm packages or APT.
ensure_runtime() {
  local root=${1:-/opt/rejista-toolchain} arch stage archive sum node_dir path
  for path in "$root" "$root/node-$NODE_MAJOR" "$root/pnpm-$PNPM_VERSION" "$root/cache"; do
    [[ ! -L $path ]] || die "Unsafe runtime symlink: $path"
    [[ ! -e $path || $(stat -c %u "$path") == 0 ]] || die "Runtime path is not root-owned: $path"
  done
  if [[ -x $root/node-$NODE_MAJOR/bin/node ]]; then
    export PATH="$root/node-$NODE_MAJOR/bin:$PATH"
  fi
  if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt $NODE_MAJOR ]]; then
    for path in curl tar sha256sum; do command -v "$path" >/dev/null || die "Missing $path for private Node setup."; done
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) die "Unsupported Node architecture." ;; esac
    [[ ! -e $root/node-$NODE_MAJOR ]] || die "Private Node runtime is incomplete; inspect $root/node-$NODE_MAJOR."
    install -d -m 755 -o root -g root "$root"
    stage=$(mktemp -d "$root/.node.XXXXXXXX")
    info "Installing private Node $NODE_MAJOR in $root (shared Node is unchanged)."
    curl -fSL --retry 2 --connect-timeout 15 --max-time 180 "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt" -o "$stage/SHASUMS256.txt" || die "Node checksum download failed. Staging files: $stage"
    archive=$(awk -v arch="$arch" '$2 ~ ("^node-v[0-9.]+-linux-" arch "\\.tar\\.gz$") {print $2}' "$stage/SHASUMS256.txt")
    [[ $archive =~ ^node-v[0-9.]+-linux-(x64|arm64)\.tar\.gz$ ]] || die "Invalid Node release manifest."
    sum=$(awk -v file="$archive" '$2 == file {print $1}' "$stage/SHASUMS256.txt")
    # Use the exact release directory, not a latest URL that can change mid-download.
    node_dir=${archive%-linux-*}
    curl -fSL --retry 2 --connect-timeout 15 --max-time 300 "https://nodejs.org/dist/${node_dir#node-}/$archive" -o "$stage/$archive" || die "Node download failed. Staging files: $stage"
    (cd "$stage" && printf '%s  %s\n' "$sum" "$archive" | sha256sum -c -) || die "Node checksum failed; runtime was not installed."
    mkdir "$stage/runtime"
    (umask 022; tar -xzf "$stage/$archive" -C "$stage/runtime" --strip-components=1)
    chmod 755 "$stage/runtime"
    "$stage/runtime/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || die "Downloaded Node cannot run on this OS."
    mv -T "$stage/runtime" "$root/node-$NODE_MAJOR"
    rm -f "$stage/$archive" "$stage/SHASUMS256.txt"
    rmdir "$stage"
    export PATH="$root/node-$NODE_MAJOR/bin:$PATH"
  fi
  if [[ -x $root/pnpm-$PNPM_VERSION/bin/pnpm ]]; then
    export PATH="$root/pnpm-$PNPM_VERSION/bin:$PATH"
  fi
  if ! command -v pnpm >/dev/null || [[ $(pnpm -v) != "$PNPM_VERSION" ]]; then
    [[ ! -e $root/pnpm-$PNPM_VERSION ]] || die "Private pnpm runtime is incomplete; inspect $root/pnpm-$PNPM_VERSION."
    command -v npm >/dev/null || die "npm is required to install private pnpm."
    install -d -m 755 -o root -g root "$root" "$root/cache"
    stage=$(mktemp -d "$root/.pnpm.XXXXXXXX")
    info "Installing private pnpm $PNPM_VERSION (global pnpm is unchanged)."
    (umask 022; npm_config_cache="$root/cache" npm_config_userconfig=/dev/null npm_config_globalconfig=/dev/null \
      npm install --prefix "$stage" --global --ignore-scripts --no-audit --no-fund "pnpm@$PNPM_VERSION") || die "Private pnpm installation failed. Staging files: $stage"
    chmod 755 "$stage"
    [[ $("$stage/bin/pnpm" -v) == "$PNPM_VERSION" ]] || die "Private pnpm verification failed."
    mv -T "$stage" "$root/pnpm-$PNPM_VERSION"
    export PATH="$root/pnpm-$PNPM_VERSION/bin:$PATH"
  fi
  NODE_BIN=$(command -v node)
  RUNTIME_PATH=$PATH
}

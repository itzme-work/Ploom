FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git gh openjdk-17-jdk-headless minisign gnupg python3 python3-yaml sudo \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash vscode \
    && install -d -m 0755 /workspaces
ADD --checksum=sha256:1dac939af3e84fb3861927c984b357531341be9403b889e4aa86e8822145a09d https://github.com/cli/cli/releases/download/v2.105.0/gh_2.105.0_linux_amd64.deb /tmp/gh.deb
RUN dpkg -i /tmp/gh.deb && rm /tmp/gh.deb
ADD --checksum=sha256:057983293b14d88b29331f96b2e57ce9780f887e7a0b76e255844924f83118dc https://github.com/tauri-apps/tauri/releases/download/tauri-cli-v2.12.6/cargo-tauri-x86_64-unknown-linux-gnu.tgz /tmp/signer.tgz
RUN set -eu; test "$(dpkg --print-architecture)" = amd64; \
    echo '057983293b14d88b29331f96b2e57ce9780f887e7a0b76e255844924f83118dc  /tmp/signer.tgz' | sha256sum -c -; \
    tar -xzf /tmp/signer.tgz -O --wildcards '*cargo-tauri' > /usr/local/bin/cargo-tauri; \
    chmod 755 /usr/local/bin/cargo-tauri; rm /tmp/signer.tgz; \
    cargo-tauri --version; cargo-tauri signer generate --help >/dev/null; gh variable set --help >/dev/null

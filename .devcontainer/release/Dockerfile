FROM mcr.microsoft.com/devcontainers/java:1-17-bookworm@sha256:4df2d907479f1779014e21538be2c0b3fae16d342a78d7a674ea129a8e302e57
RUN apt-get update && apt-get install -y --no-install-recommends gh minisign gnupg python3 && gh variable set --help >/dev/null && rm -rf /var/lib/apt/lists/*

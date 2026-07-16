FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git sudo ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN id -u ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu \
  && usermod -aG sudo ubuntu \
  && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu

WORKDIR /workspace
USER ubuntu

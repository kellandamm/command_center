FROM ubuntu/squid:latest@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029

# Site-specific allowlist stays volume-mounted at deploy (compose mounts ./egress/squid.conf).
# This image exists so VM pulls stay on private GHCR instead of Docker Hub.

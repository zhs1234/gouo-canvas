# 官方固定版本发布二进制，SHA-256 来自该 release 的 checksums-linux.txt。
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
FROM scratch AS amd64
ADD --checksum=sha256:a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529 https://github.com/QuantumNous/new-api/releases/download/v1.0.0-rc.40/new-api-v1.0.0-rc.40 /new-api
FROM scratch AS arm64
ADD --checksum=sha256:8689cc98471806eb03093849abdcfe974e582b85571b44da0d1816b21b360227 https://github.com/QuantumNous/new-api/releases/download/v1.0.0-rc.40/new-api-arm64-v1.0.0-rc.40 /new-api
FROM ${TARGETARCH} AS binary
FROM ${NODE_IMAGE}
COPY --from=binary --chmod=755 /new-api /usr/local/bin/new-api
# 使用 Node 附带的公共根证书供 Go HTTPS 客户端验证，不复制宿主私有证书。
RUN mkdir -p /etc/ssl/certs && node -e "require('fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt',require('tls').rootCertificates.join('\\n'))"
ADD https://raw.githubusercontent.com/QuantumNous/new-api/0aec08fee811ec6136828fda790551b49e410301/LICENSE /licenses/LICENSE
ADD https://raw.githubusercontent.com/QuantumNous/new-api/0aec08fee811ec6136828fda790551b49e410301/NOTICE /licenses/NOTICE
ADD https://raw.githubusercontent.com/QuantumNous/new-api/0aec08fee811ec6136828fda790551b49e410301/THIRD-PARTY-LICENSES.md /licenses/THIRD-PARTY-LICENSES.md
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/new-api"]

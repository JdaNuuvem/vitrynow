#!/bin/sh
# Monta os remotos do rclone SÓ por variável de ambiente (nenhum arquivo de config com segredo em disco).
#   raw:     o bucket S3 compatível (dados já cifrados)
#   offsite: camada crypt por cima de raw:BUCKET/PREFIXO — tudo que passa por aqui é cifrado no cliente (conteúdo e nomes).
: "${OFFSITE_S3_BUCKET:?defina OFFSITE_S3_BUCKET}"
: "${OFFSITE_CRYPT_PASSWORD:?defina OFFSITE_CRYPT_PASSWORD}"
: "${OFFSITE_CRYPT_SALT:?defina OFFSITE_CRYPT_SALT}"
export RCLONE_CONFIG_RAW_TYPE=s3
export RCLONE_CONFIG_RAW_PROVIDER="${OFFSITE_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_RAW_ENDPOINT="${OFFSITE_S3_ENDPOINT:-}"
export RCLONE_CONFIG_RAW_REGION="${OFFSITE_S3_REGION:-auto}"
export RCLONE_CONFIG_RAW_ACCESS_KEY_ID="${OFFSITE_S3_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_RAW_SECRET_ACCESS_KEY="${OFFSITE_S3_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_RAW_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_OFFSITE_TYPE=crypt
export RCLONE_CONFIG_OFFSITE_REMOTE="raw:${OFFSITE_S3_BUCKET}/${OFFSITE_PREFIX:-vitry}"
export RCLONE_CONFIG_OFFSITE_FILENAME_ENCRYPTION=standard
RCLONE_CONFIG_OFFSITE_PASSWORD="$(rclone obscure "$OFFSITE_CRYPT_PASSWORD")" || { echo "offsite: rclone obscure falhou"; exit 1; }
RCLONE_CONFIG_OFFSITE_PASSWORD2="$(rclone obscure "$OFFSITE_CRYPT_SALT")" || { echo "offsite: rclone obscure falhou"; exit 1; }
export RCLONE_CONFIG_OFFSITE_PASSWORD RCLONE_CONFIG_OFFSITE_PASSWORD2

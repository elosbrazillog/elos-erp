#!/bin/sh
# Recria o banco de teste local e roda as migrations + o teste de fluxo
P="psql -h /tmp/pg -p 5433 -U postgres -q"
cd "$(dirname "$0")/.."
$P -c "drop database if exists t" -c "create database t" || exit 1
for f in tests/supabase_stub.sql migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d t -f "$f" || { echo "FALHOU: $f"; exit 1; }; done
$P -d t -f tests/teste_fluxo.sql
$P -d t -f tests/teste_fase2.sql

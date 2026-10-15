#!/bin/sh
# Recria o banco de teste local e roda as migrations + o teste de fluxo
P="psql -h /tmp/pg -p 5433 -U postgres -q"
cd "$(dirname "$0")/.."
$P -c "drop database if exists t" -c "create database t" || exit 1
for f in tests/supabase_stub.sql migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d t -f "$f" || { echo "FALHOU: $f"; exit 1; }; done
$P -d t -f tests/teste_fluxo.sql
$P -d t -f tests/teste_fase2.sql
$P -d t -f tests/teste_expedicao.sql
$P -d t -f tests/teste_financeiro.sql
$P -d t -f tests/teste_relatorios.sql
$P -d t -f tests/teste_forca_vendas.sql
$P -d t -f tests/teste_metas.sql
$P -d t -f tests/teste_faturamento.sql
$P -d t -f tests/teste_painel.sql
$P -d t -f tests/teste_equipe.sql
$P -d t -f tests/teste_acerto.sql
$P -d t -f tests/teste_despesas.sql
$P -d t -f tests/teste_dre.sql
$P -d t -f tests/teste_comissoes.sql

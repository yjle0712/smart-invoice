#!/usr/bin/env bash
# Applique les migrations sur un PostgreSQL local (port 54329) et exécute les scénarios.
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists si_test" -c "create database si_test"
$PSQL -d si_test -f tests/00_supabase_stub.sql
for f in migrations/*.sql; do $PSQL -d si_test -f "$f"; done
$PSQL -d si_test -o /dev/null -f tests/01_scenarios.sql
$PSQL -d si_test -o /dev/null -f tests/02_journal_tva.sql
$PSQL -d si_test -o /dev/null -f tests/03_bons.sql
$PSQL -d si_test -o /dev/null -f tests/04_partage.sql
$PSQL -d si_test -o /dev/null -f tests/05_paiement.sql
$PSQL -d si_test -o /dev/null -f tests/06_numerotation_client.sql

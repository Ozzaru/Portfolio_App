-- supabase/migrations/0002_price_cache_adj_close.sql
-- Fase 3: cierre ajustado junto al crudo (bifurcación raw/adjusted, Decisión 0).
-- Aditiva y nullable: las filas existentes y el endpoint /api/positions no cambian
-- (en la fecha más reciente adj_price == price). El motor de analytics coalesce
-- adj_price ?? price al leer, así que filas antiguas degradan con gracia.
alter table price_cache add column adj_price numeric;

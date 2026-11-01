-- Algunos pedidos (importados) guardan en sale_gs el precio POR UNIDAD. Para
-- editar o fusionar se pasan a total de línea (como el resto de la app).
CREATE OR REPLACE FUNCTION public.order_items_line_totals(p_items jsonb, p_total numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s numeric; sq numeric;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(sum(coalesce(nullif(x->>'sale_gs','')::numeric, 0)), 0),
         coalesce(sum(coalesce(nullif(x->>'sale_gs','')::numeric, 0) * coalesce(nullif(x->>'qty','')::numeric, 1)), 0)
    INTO s, sq FROM jsonb_array_elements(p_items) x;
  IF abs(coalesce(p_total, 0) - s) >= 1 AND abs(coalesce(p_total, 0) - sq) < 1 THEN
    RETURN (SELECT coalesce(jsonb_agg(x || jsonb_build_object('sale_gs', coalesce(nullif(x->>'sale_gs','')::numeric, 0) * coalesce(nullif(x->>'qty','')::numeric, 1))), '[]'::jsonb)
            FROM jsonb_array_elements(p_items) x);
  END IF;
  RETURN p_items;
END; $$;
-- merge_orders usa order_items_line_totals al juntar productos, y edit_order_items /
-- merge_orders guardan su registro con event_type 'edit' / 'merge' (sin notificación push).
-- (Aplicado en la base como migraciones order_items_line_totals y order_edit_merge_no_push.)

-- 📦 Empaquetado: el despachante (o admin / proveedor) marca cada pedido como empaquetado.
-- Cada empaque vale lo que cobra el proveedor del pedido (por defecto Gs 3.500, el admin
-- puede fijar el precio de todos). El despachante solicita el cobro de sus empaques y el
-- proveedor / admin lo aprueba en Comisiones → quedan pagados.

-- Precio por empaque de cada proveedor.
CREATE TABLE IF NOT EXISTS public.packing_rates (
  provider_email text PRIMARY KEY,
  price_gs numeric NOT NULL DEFAULT 3500 CHECK (price_gs >= 0),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.packing_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packing rates readable" ON public.packing_rates;
CREATE POLICY "packing rates readable" ON public.packing_rates FOR SELECT TO authenticated USING (true);

-- Solicitudes de cobro (una por despachante y proveedor).
CREATE TABLE IF NOT EXISTS public.packing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatcher_email text NOT NULL,
  provider_email text NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  total_gs numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'PAGADO', 'RECHAZADO')),
  note text,
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);
CREATE INDEX IF NOT EXISTS packing_requests_dispatcher_idx ON public.packing_requests (lower(dispatcher_email));
CREATE INDEX IF NOT EXISTS packing_requests_provider_idx ON public.packing_requests (lower(provider_email));
ALTER TABLE public.packing_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packing requests visible" ON public.packing_requests;
CREATE POLICY "packing requests visible" ON public.packing_requests FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'ADMIN')
  OR lower(dispatcher_email) = (SELECT public.current_profile_email())
  OR lower(provider_email) = (SELECT public.current_profile_email())
);

-- Datos del empaque en el pedido (los ve todo el que ve el pedido).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packed_by text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packing_gs numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packing_provider text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packing_request_id uuid REFERENCES public.packing_requests(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packing_paid_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_packed_at_idx ON public.orders (packed_at) WHERE packed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_packing_request_idx ON public.orders (packing_request_id) WHERE packing_request_id IS NOT NULL;

-- Los datos del empaque sólo se cambian con las funciones de abajo.
CREATE OR REPLACE FUNCTION public.orders_packing_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF coalesce(current_setting('app.packing', true), '') <> '1' AND (
       NEW.packed_at IS DISTINCT FROM OLD.packed_at OR NEW.packed_by IS DISTINCT FROM OLD.packed_by
    OR NEW.packing_gs IS DISTINCT FROM OLD.packing_gs OR NEW.packing_provider IS DISTINCT FROM OLD.packing_provider
    OR NEW.packing_request_id IS DISTINCT FROM OLD.packing_request_id OR NEW.packing_paid_at IS DISTINCT FROM OLD.packing_paid_at) THEN
    NEW.packed_at := OLD.packed_at; NEW.packed_by := OLD.packed_by; NEW.packing_gs := OLD.packing_gs;
    NEW.packing_provider := OLD.packing_provider; NEW.packing_request_id := OLD.packing_request_id;
    NEW.packing_paid_at := OLD.packing_paid_at;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS orders_packing_guard ON public.orders;
CREATE TRIGGER orders_packing_guard BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_packing_guard();

-- Precio: admin cualquier proveedor (o todos con p_provider NULL); proveedor el suyo.
CREATE OR REPLACE FUNCTION public.set_packing_rate(p_provider text, p_price numeric)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  is_admin boolean := public.has_role(auth.uid(), 'ADMIN');
  n integer := 0;
BEGIN
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'Precio inválido'; END IF;
  IF p_provider IS NULL THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'Sólo el admin puede cambiar el precio de todos'; END IF;
    INSERT INTO public.packing_rates (provider_email, price_gs, updated_by, updated_at)
    SELECT DISTINCT lower(p.email), p_price, me, now()
    FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.user_id
    WHERE upper(r.role::text) = 'PROVEEDOR' AND coalesce(r.approved, false) AND nullif(trim(p.email), '') IS NOT NULL
    ON CONFLICT (provider_email) DO UPDATE SET price_gs = EXCLUDED.price_gs, updated_by = me, updated_at = now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  IF NOT is_admin AND (lower(trim(p_provider)) <> me OR NOT public.has_role(auth.uid(), 'PROVEEDOR')) THEN
    RAISE EXCEPTION 'Sólo podés cambiar tu propio precio de empaque';
  END IF;
  INSERT INTO public.packing_rates (provider_email, price_gs, updated_by, updated_at)
  VALUES (lower(trim(p_provider)), p_price, me, now())
  ON CONFLICT (provider_email) DO UPDATE SET price_gs = EXCLUDED.price_gs, updated_by = me, updated_at = now();
  RETURN 1;
END $function$;
REVOKE ALL ON FUNCTION public.set_packing_rate(text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_packing_rate(text, numeric) TO authenticated;

-- Marcar / desmarcar empaquetado (uno o varios pedidos).
CREATE OR REPLACE FUNCTION public.mark_orders_packed(p_ids uuid[], p_packed boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  is_admin boolean := public.has_role(auth.uid(), 'ADMIN');
  is_disp boolean := public.has_role(auth.uid(), 'DESPACHANTE');
  is_prov boolean := public.has_role(auth.uid(), 'PROVEEDOR');
  mine text[];
  o record;
  prov text;
  ok integer := 0;
  skipped integer := 0;
BEGIN
  IF me IS NULL OR me = '' OR NOT (is_admin OR is_disp OR is_prov) THEN
    RAISE EXCEPTION 'No tenés permiso para marcar empaques';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'Elegí entre 1 y 500 pedidos';
  END IF;
  IF is_disp AND NOT is_admin THEN mine := public.my_dispatch_providers(); END IF;
  PERFORM set_config('app.packing', '1', true);

  FOR o IN SELECT * FROM public.orders WHERE id = ANY (p_ids) FOR UPDATE LOOP
    prov := lower(trim(coalesce(nullif(trim(o.provider_email), ''),
              split_part(regexp_replace(coalesce(o.provider_emails_list, ''), '[;[:space:]]+', ',', 'g'), ',', 1))));
    -- Permisos sobre el pedido.
    IF NOT is_admin THEN
      IF is_disp AND NOT (cardinality(coalesce(mine, ARRAY[]::text[])) = 0 OR prov = ANY (mine)
           OR regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+') && mine) THEN
        skipped := skipped + 1; CONTINUE;
      ELSIF NOT is_disp AND prov <> me
           AND NOT (me = ANY (regexp_split_to_array(lower(coalesce(o.provider_emails_list, '')), '[,;[:space:]]+'))) THEN
        skipped := skipped + 1; CONTINUE;
      END IF;
    END IF;

    IF p_packed THEN
      IF o.packed_at IS NOT NULL THEN skipped := skipped + 1; CONTINUE; END IF;
      UPDATE public.orders SET
        packed_at = now(), packed_by = me, packing_provider = nullif(prov, ''),
        packing_gs = coalesce((SELECT r.price_gs FROM public.packing_rates r WHERE r.provider_email = prov), 3500),
        packing_request_id = NULL, packing_paid_at = NULL
      WHERE id = o.id;
      ok := ok + 1;
    ELSE
      -- Sólo quien lo empaquetó (o el admin), y si todavía no se pidió el cobro.
      IF o.packed_at IS NULL OR o.packing_request_id IS NOT NULL OR o.packing_paid_at IS NOT NULL
         OR (NOT is_admin AND lower(coalesce(o.packed_by, '')) <> me) THEN
        skipped := skipped + 1; CONTINUE;
      END IF;
      UPDATE public.orders SET packed_at = NULL, packed_by = NULL, packing_gs = NULL, packing_provider = NULL
      WHERE id = o.id;
      ok := ok + 1;
    END IF;
  END LOOP;
  PERFORM set_config('app.packing', '', true);
  RETURN jsonb_build_object('ok', ok, 'skipped', skipped);
END $function$;
REVOKE ALL ON FUNCTION public.mark_orders_packed(uuid[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_orders_packed(uuid[], boolean) TO authenticated;

-- Empaques por día (admin: todos; proveedor: los suyos; despachante: los que hizo).
CREATE OR REPLACE FUNCTION public.packing_summary(p_from date, p_to date)
RETURNS TABLE (day date, packed_by text, provider_email text, qty bigint, total_gs numeric, requested_gs numeric, paid_gs numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  is_admin boolean := public.has_role(auth.uid(), 'ADMIN');
BEGIN
  IF me IS NULL OR me = '' THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  RETURN QUERY
  SELECT (o.packed_at AT TIME ZONE 'America/Asuncion')::date,
         lower(o.packed_by), coalesce(o.packing_provider, ''),
         count(*), sum(coalesce(o.packing_gs, 0)),
         sum(CASE WHEN o.packing_request_id IS NOT NULL AND o.packing_paid_at IS NULL THEN coalesce(o.packing_gs, 0) ELSE 0 END),
         sum(CASE WHEN o.packing_paid_at IS NOT NULL THEN coalesce(o.packing_gs, 0) ELSE 0 END)
  FROM public.orders o
  WHERE o.packed_at IS NOT NULL
    AND o.packed_at >= (p_from::timestamp AT TIME ZONE 'America/Asuncion')
    AND o.packed_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Asuncion')
    AND (is_admin OR lower(o.packed_by) = me OR o.packing_provider = me)
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 4 DESC;
END $function$;
REVOKE ALL ON FUNCTION public.packing_summary(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.packing_summary(date, date) TO authenticated;

-- Empaques míos sin cobrar (para la pestaña Cobro de empaques).
CREATE OR REPLACE FUNCTION public.my_unrequested_packings()
RETURNS TABLE (id uuid, order_number text, customer_name text, city text, status text, provider_email text, packing_gs numeric, packed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT o.id, o.order_number, o.customer_name, o.city, o.status, coalesce(o.packing_provider, ''), coalesce(o.packing_gs, 0), o.packed_at
  FROM public.orders o
  WHERE o.packed_at IS NOT NULL AND o.packing_request_id IS NULL AND o.packing_paid_at IS NULL
    AND lower(o.packed_by) = public.current_profile_email()
  ORDER BY o.packed_at DESC
  LIMIT 5000;
$function$;
REVOKE ALL ON FUNCTION public.my_unrequested_packings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_unrequested_packings() TO authenticated;

-- Detalle de una solicitud.
CREATE OR REPLACE FUNCTION public.packing_request_orders(p_request uuid)
RETURNS TABLE (id uuid, order_number text, customer_name text, city text, status text, packing_gs numeric, packed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  r public.packing_requests;
BEGIN
  SELECT * INTO r FROM public.packing_requests WHERE packing_requests.id = p_request;
  IF r.id IS NULL OR NOT (public.has_role(auth.uid(), 'ADMIN') OR lower(r.dispatcher_email) = me OR lower(r.provider_email) = me) THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  RETURN QUERY SELECT o.id, o.order_number, o.customer_name, o.city, o.status, coalesce(o.packing_gs, 0), o.packed_at
  FROM public.orders o WHERE o.packing_request_id = p_request ORDER BY o.packed_at;
END $function$;
REVOKE ALL ON FUNCTION public.packing_request_orders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.packing_request_orders(uuid) TO authenticated;

-- Solicitar el cobro de todos mis empaques pendientes (se separa por proveedor).
CREATE OR REPLACE FUNCTION public.request_packing_payment()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  g record;
  rid uuid;
  n integer := 0;
  total numeric := 0;
BEGIN
  IF me IS NULL OR me = '' THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  PERFORM set_config('app.packing', '1', true);
  FOR g IN
    SELECT coalesce(o.packing_provider, '') AS prov, count(*)::int AS qty, sum(coalesce(o.packing_gs, 0)) AS gs
    FROM public.orders o
    WHERE o.packed_at IS NOT NULL AND o.packing_request_id IS NULL AND o.packing_paid_at IS NULL
      AND lower(o.packed_by) = me
    GROUP BY 1
  LOOP
    INSERT INTO public.packing_requests (dispatcher_email, provider_email, qty, total_gs)
    VALUES (me, g.prov, g.qty, g.gs) RETURNING id INTO rid;
    UPDATE public.orders o SET packing_request_id = rid
    WHERE o.packed_at IS NOT NULL AND o.packing_request_id IS NULL AND o.packing_paid_at IS NULL
      AND lower(o.packed_by) = me AND coalesce(o.packing_provider, '') = g.prov;
    n := n + 1;
    total := total + g.gs;
  END LOOP;
  PERFORM set_config('app.packing', '', true);
  IF n = 0 THEN RAISE EXCEPTION 'No tenés empaques pendientes de cobro'; END IF;
  RETURN jsonb_build_object('requests', n, 'total_gs', total);
END $function$;
REVOKE ALL ON FUNCTION public.request_packing_payment() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_packing_payment() TO authenticated;

-- Aprobar (pagado) o rechazar una solicitud: admin o el proveedor de la solicitud.
CREATE OR REPLACE FUNCTION public.resolve_packing_request(p_id uuid, p_paid boolean, p_note text DEFAULT NULL, p_receipt text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  me text := public.current_profile_email();
  r public.packing_requests;
BEGIN
  SELECT * INTO r FROM public.packing_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR lower(r.provider_email) = me) THEN
    RAISE EXCEPTION 'No podés aprobar esta solicitud';
  END IF;
  IF r.status <> 'PENDIENTE' THEN RAISE EXCEPTION 'La solicitud ya fue resuelta'; END IF;
  PERFORM set_config('app.packing', '1', true);
  IF p_paid THEN
    UPDATE public.packing_requests SET status = 'PAGADO', resolved_at = now(), resolved_by = me,
      note = coalesce(nullif(trim(p_note), ''), note), receipt_url = coalesce(nullif(trim(p_receipt), ''), receipt_url)
    WHERE id = p_id;
    UPDATE public.orders SET packing_paid_at = now() WHERE packing_request_id = p_id;
  ELSE
    UPDATE public.packing_requests SET status = 'RECHAZADO', resolved_at = now(), resolved_by = me,
      note = coalesce(nullif(trim(p_note), ''), note)
    WHERE id = p_id;
    -- Los empaques vuelven a quedar pendientes de cobro.
    UPDATE public.orders SET packing_request_id = NULL WHERE packing_request_id = p_id;
  END IF;
  PERFORM set_config('app.packing', '', true);
END $function$;
REVOKE ALL ON FUNCTION public.resolve_packing_request(uuid, boolean, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_packing_request(uuid, boolean, text, text) TO authenticated;

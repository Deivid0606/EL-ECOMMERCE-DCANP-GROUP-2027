import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);
const validFile = (f: File) =>
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type) &&
  f.size <= 8 * 1024 * 1024;

const isPdfPath = (path: string) => path.toLowerCase().endsWith('.pdf');
const getStatusStyles = (status: string) => {
  switch (status) {
    case 'APROBADO':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    case 'RECHAZADO':
      return 'bg-red-500/15 text-red-300 border border-red-500/30';
    default:
      return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  }
};

type Props = { role: string; email: string; userId?: string; view?: 'pagos' | 'historial' | 'config' };

// Fecha de Paraguay (YYYY-MM-DD).
const pyDay = (value: string | Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date(value));

// Igual que next_business_day() en la base: lunes a jueves → día siguiente;
// viernes, sábado y domingo → lunes.
const nextBusinessDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 domingo … 6 sábado
  d.setUTCDate(d.getUTCDate() + (dow === 5 ? 3 : dow === 6 ? 2 : 1));
  return d.toISOString().slice(0, 10);
};

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('es-PY', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

const isUnreported = (status: string | null | undefined) => ['', 'PENDIENTE', 'EN RUTA'].includes(String(status || '').trim().toUpperCase());
const staysOnDay = (status: string | null | undefined) =>
  ['ENTREGADO', 'ENCOMIENDA ENTREGADA', 'DEVUELTO A DEPÓSITO'].includes(String(status || '').trim().toUpperCase());

type DayOrder = { id: string; order_number: string | null; status: string | null; day_seq: number | null; customer_name: string | null; city: string | null; assigned_at: string };
type DayClosure = { day: string; next_day: string; orders_total: number; delivered: number; moved: number; finalized_at: string };

type ReceiptPreview = {
  url: string;
  path: string;
  isPdf: boolean;
};

export default function ClosurePaymentsPanel({ role, email, userId, view = 'pagos' }: Props) {
  const [banks, setBanks] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [recovery, setRecovery] = useState<any[]>([]);
  const [orphans, setOrphans] = useState<any[]>([]);
  const [orderList, setOrderList] = useState<any[]>([]);
  const [deliveryFees, setDeliveryFees] = useState<any[]>([]);
  const [feesLoadError, setFeesLoadError] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [providerSearch, setProviderSearch] = useState('');
  const [newReceipt, setNewReceipt] = useState<File | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'TODOS' | 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'>('TODOS');
  const [historySearch, setHistorySearch] = useState('');
  const [preview, setPreview] = useState<ReceiptPreview | null>(null);

  const emptyBank = { bank_name: '', bank_account: '', bank_holder: '', bank_ci: '', bank_alias: '' };
  const [bank, setBank] = useState(emptyBank);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [applyToOwnAccount, setApplyToOwnAccount] = useState(false);
  const [providers, setProviders] = useState<{ user_id: string; name: string | null; email: string | null }[]>([]);

  // Finalicé mi día
  const today = pyDay();
  const [dayOrders, setDayOrders] = useState<DayOrder[]>([]);
  const [dayClosure, setDayClosure] = useState<DayClosure | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const canOwnBank = role === 'ADMIN' || role === 'PROVEEDOR';
  const isDelivery = role === 'DELIVERY';

  const reload = async () => {
    const [b, h] = await Promise.all([
      supabase.from('closure_bank_destinations').select('*'),
      supabase.from('delivery_closure_submissions').select('*').order('created_at', { ascending: false }).limit(150),
    ]);

    if (b.error || h.error) {
      toast.error(b.error?.message || h.error?.message || 'Ejecutá primero el SQL adjunto');
      return;
    }

    setBanks(b.data || []);
    setHistory(h.data || []);

    if (isDelivery || role === 'ADMIN') {
      const drafts = await supabase
        .from('delivery_closure_recovery' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (drafts.error) toast.error('No se pudo consultar recuperación de cierres: ' + drafts.error.message);
      else setRecovery(drafts.data || []);
    }

    if (role === 'ADMIN') {
      const missing = await (supabase as any).rpc('list_unlinked_closure_receipts');
      if (missing.error) toast.error('No se pudieron consultar comprobantes sin cierre: ' + missing.error.message);
      else setOrphans(missing.data || []);
    }

    if (isDelivery) {
      await loadDay();

      const { data: options, error: optionError } = await (supabase as any).rpc('list_delivery_bank_destinations');
      setCatalog((options || []).filter((b: any) => b.owner_role === 'PROVEEDOR'));
      setCatalogError(optionError ? 'No se pudieron consultar las cuentas bancarias: ' + optionError.message : '');
      if (optionError) {
        toast.error('No se pudieron cargar las cuentas de destino. Ejecutá el SQL de esta actualización.');
      }

      const feeResult = await (supabase as any).rpc('get_closure_delivery_fees');
      if (feeResult.error) {
        setFeesLoadError('No se pudieron consultar las tarifas: ' + feeResult.error.message);
        setDeliveryFees([]);
      } else {
        setFeesLoadError('');
        setDeliveryFees(feeResult.data || []);
      }

      const baseSelect = 'id,order_number,status,status2,total_gs,delivery_fee_gs,city,provider_emails_list,provider_email,supplier_email,delivery_settled,assigned_delivery';
      const { data, error } = await supabase
        .from('orders')
        .select(baseSelect)
        .ilike('assigned_delivery', email)
        .in('status', ['ENTREGADO', 'ENCOMIENDA ENTREGADA'])
        .eq('delivery_settled', false)
        .range(0, 499);

      if (error) {
        toast.error(error.message);
        setOrderList([]);
        return;
      }

      const all = [...(data || [])];
      let offset = 500;

      while (all.length === offset && offset < 5000) {
        const page = await supabase
          .from('orders')
          .select(baseSelect)
          .ilike('assigned_delivery', email)
          .in('status', ['ENTREGADO', 'ENCOMIENDA ENTREGADA'])
          .eq('delivery_settled', false)
          .range(offset, offset + 499);

        if (page.error) {
          toast.error('No se pudieron cargar todos los pedidos: ' + page.error.message);
          setOrderList([]);
          return;
        }

        all.push(...(page.data || []));
        if ((page.data || []).length < 500) break;
        offset += 500;
      }

      setOrderList(all);
    }
  };

  const loadDay = async () => {
    // Pedidos asignados hoy (hora de Paraguay) y si el día ya se finalizó.
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const [ordersRes, closureRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id,order_number,status,day_seq,customer_name,city,assigned_at')
        .ilike('assigned_delivery', email)
        .gte('assigned_at', since)
        .order('day_seq', { ascending: true }),
      supabase
        .from('delivery_day_closures' as any)
        .select('day,next_day,orders_total,delivered,moved,finalized_at')
        .eq('delivery_email', email.toLowerCase())
        .eq('day', today)
        .maybeSingle(),
    ]);
    if (!ordersRes.error) setDayOrders(((ordersRes.data || []) as unknown as DayOrder[]).filter(o => pyDay(o.assigned_at) === today));
    if (!closureRes.error) setDayClosure((closureRes.data as unknown as DayClosure) || null);
  };

  const finalizeDay = async () => {
    const unreported = dayOrders.filter(o => isUnreported(o.status));
    if (unreported.length) {
      toast.error(`Te faltan reportar ${unreported.length} pedido(s): ${unreported.map(o => `#${o.day_seq || ''} ${o.order_number || ''}`).join(', ')}`);
      return;
    }
    const moving = dayOrders.filter(o => !staysOnDay(o.status));
    const next = nextBusinessDay(today);
    if (
      !confirm(
        `¿Finalizar tu día ${dayLabel(today)}?\n\n` +
          `${dayOrders.length - moving.length} pedido(s) quedan en hoy (entregados / devueltos).\n` +
          `${moving.length} pedido(s) pasan al ${dayLabel(next)}.\n\nNo se puede deshacer.`,
      )
    )
      return;

    setFinalizing(true);
    const { data, error } = await (supabase as any).rpc('finalize_delivery_day', { p_day: today });
    setFinalizing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = (data || {}) as { ok?: boolean; error?: string; moved?: number; next_day?: string; pending?: { order_number: string }[] };
    if (!result.ok) {
      toast.error(`${result.error || 'No se pudo finalizar el día'}${result.pending?.length ? `: ${result.pending.map(p => p.order_number).join(', ')}` : ''}`);
      await loadDay();
      return;
    }
    toast.success(`✅ Día finalizado. ${result.moved || 0} pedido(s) pasaron al ${dayLabel(result.next_day || next)}.`);
    await loadDay();
  };

  // Obligatorio: con pedidos asignados hoy, primero se finaliza el día.
  const dayPending = isDelivery && dayOrders.length > 0 && !dayClosure;

  useEffect(() => {
    if (email) void reload();
  }, [email, role, userId]);

  useEffect(() => {
    if (role !== 'ADMIN') return;
    (async () => {
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('user_id,role')
        .eq('role', 'PROVEEDOR')
        .eq('approved', true);
      if (error) {
        toast.error('No se pudo cargar la lista de proveedores: ' + error.message);
        return;
      }
      const ids = [...new Set((roles || []).map((r: any) => r.user_id))];
      if (!ids.length) {
        setProviders([]);
        return;
      }
      const { data: people, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id,name,email')
        .in('user_id', ids);
      if (profilesError) {
        toast.error('No se pudieron cargar los proveedores: ' + profilesError.message);
        return;
      }
      setProviders(people || []);
    })();
  }, [role]);

  useEffect(() => {
    if (role !== 'PROVEEDOR' || !userId) return;
    const saved = banks.find(b => b.owner_user_id === userId);
    setBank(
      saved
        ? {
            bank_name: saved.bank_name || '',
            bank_account: saved.bank_account || '',
            bank_holder: saved.bank_holder || '',
            bank_ci: saved.bank_ci || '',
            bank_alias: saved.bank_alias || '',
          }
        : emptyBank,
    );
  }, [role, userId, banks]);

  const dest = catalog.find(b => b.owner_user_id === destination && b.owner_role === 'PROVEEDOR');
  const destEmail = String(dest?.owner_email || '').trim().toLowerCase();

  const eligible = useMemo(
    () =>
      orderList.filter(o => {
        if (!dest || !destEmail) return false;
        const addresses = [
          ...String(o.provider_emails_list || '')
            .toLowerCase()
            .split(/[,;\s]+/),
          String(o.provider_email || '').toLowerCase(),
          String(o.supplier_email || '').toLowerCase(),
        ]
          .map(x => x.trim())
          .filter(Boolean);
        return addresses.includes(destEmail);
      }),
    [orderList, dest, destEmail],
  );

  const selected = eligible;

  const normalize = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const feeInfo = (o: any) => {
    const frozen = Number(o.delivery_fee_gs || 0);
    if (frozen > 0) return { fee: frozen, configured: true };
    const matching = deliveryFees.find(
      (f: any) => normalize(f.delivery_email) === normalize(o.assigned_delivery) && normalize(f.city) === normalize(o.city),
    );
    return { fee: Number(matching?.fee_gs || 0), configured: Boolean(matching) };
  };

  const orderLimitReached = orderList.length >= 5000;
  const selectedMissingRate = selected.some(o => !feeInfo(o).configured);
  const collected = selected.reduce((sum, o) => sum + (o.status === 'ENTREGADO' ? Number(o.total_gs || 0) : 0), 0);
  const deliveryPay = selected.reduce((sum, o) => sum + feeInfo(o).fee, 0);
  const total = collected - deliveryPay;

  const historyKpis = useMemo(() => {
    const totalCount = history.length;
    const pending = history.filter(c => c.status === 'PENDIENTE').length;
    const approved = history.filter(c => c.status === 'APROBADO').length;
    const rejected = history.filter(c => c.status === 'RECHAZADO').length;
    return { totalCount, pending, approved, rejected };
  }, [history]);

  const filteredHistory = useMemo(() => {
    const term = historySearch.trim().toLowerCase();
    return history.filter(c => {
      const statusOk = historyStatusFilter === 'TODOS' ? true : c.status === historyStatusFilter;
      if (!statusOk) return false;
      if (!term) return true;
      return [c.delivery_email, c.destination_email, c.id, c.reviewed_by, c.rejection_reason]
        .map(v => String(v || '').toLowerCase())
        .some(v => v.includes(term));
    });
  }, [history, historySearch, historyStatusFilter]);

  const saveBank = async () => {
    const targets =
      role === 'ADMIN'
        ? [...new Set([...selectedProviderIds, ...(applyToOwnAccount && userId ? [userId] : [])])]
        : userId
          ? [userId]
          : [];

    if (!targets.length || !bank.bank_name.trim() || !bank.bank_account.trim() || !bank.bank_holder.trim()) {
      toast.error('Seleccioná al menos un destinatario y completá banco, cuenta y titular');
      return;
    }

    if (role !== 'ADMIN' && (targets.length !== 1 || targets[0] !== userId)) {
      toast.error('Solo podés editar tu propia cuenta');
      return;
    }

    if (role === 'ADMIN' && targets.some(id => id !== userId && !providers.some(p => p.user_id === id))) {
      toast.error('Uno de los proveedores seleccionados no está autorizado');
      return;
    }

    if (
      role === 'ADMIN' &&
      !confirm(`¿Guardar estos mismos datos bancarios para ${targets.length} destinatario(s)? Esto reemplazará los datos previos de los seleccionados.`)
    ) {
      return;
    }

    setBusy(true);
    try {
      const now = new Date().toISOString();
      const rows = targets.map(owner_user_id => ({ owner_user_id, ...bank, updated_at: now }));
      const { error } = await supabase.from('closure_bank_destinations').upsert(rows, { onConflict: 'owner_user_id' });
      if (error) throw error;
      toast.success(`Datos bancarios guardados para ${targets.length} destinatario(s)`);
      await reload();
    } catch (e: any) {
      toast.error(e.message || 'No se pudieron guardar los datos bancarios');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (folder: string, id: string, file: File) => {
    if (!validFile(file)) throw new Error('Archivo inválido: JPG, PNG, WEBP o PDF hasta 8 MB');
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
    const path = `${folder}/${id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('financial-receipts').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  const finishRecovery = async (draft: any) => {
    setBusy(true);
    try {
      const { data: found, error: findError } = await supabase
        .from('delivery_closure_submissions')
        .select('id')
        .eq('receipt_path', draft.receipt_path)
        .limit(1);
      if (findError) throw findError;
      if (found?.length) {
        await supabase.from('delivery_closure_recovery' as any).update({ status: 'COMPLETADO', last_error: null }).eq('id', draft.id);
        toast.success('Este comprobante ya pertenece a un cierre; no se duplicó.');
        await reload();
        return;
      }
      const { data: fileData, error: fileError } = await supabase.storage.from('financial-receipts').info(draft.receipt_path);
      if (fileError || !fileData) {
        throw new Error('El archivo todavía no está cargado. Volvé a seleccionarlo y realizá un nuevo envío.');
      }
      const { error } = await (supabase as any).rpc('submit_delivery_closure_with_receipt', {
        p_destination_user_id: draft.destination_user_id,
        p_order_ids: draft.order_ids,
        p_receipt_path: draft.receipt_path,
      });
      if (error) throw error;
      await supabase.from('delivery_closure_recovery' as any).update({ status: 'COMPLETADO', last_error: null }).eq('id', draft.id);
      toast.success('Cierre registrado correctamente. Pendiente de aprobación.');
      setNewReceipt(null);
      await reload();
    } catch (e: any) {
      await supabase.from('delivery_closure_recovery' as any).update({ last_error: e.message || 'Error desconocido' }).eq('id', draft.id);
      toast.error('Cierre NO registrado: ' + (e.message || 'Error desconocido'));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (dayPending) {
      toast.error('Primero tocá "Finalicé mi día" para cerrar los pedidos de hoy.');
      return;
    }
    if (!destination || !selectedDestinations.includes(destination) || !selected.length) {
      toast.error('Seleccioná un proveedor que tenga pedidos entregados pendientes de rendición');
      return;
    }
    if (!newReceipt || !validFile(newReceipt)) {
      toast.error('Adjuntá un comprobante válido de hasta 8 MB');
      return;
    }
    if (feesLoadError || selectedMissingRate || total < 0 || orderLimitReached) {
      toast.error('Revisá las tarifas y el saldo del cierre');
      return;
    }
    if (!userId) {
      toast.error('No se identificó tu usuario');
      return;
    }
    if (!confirm(`¿Confirmás que transferiste Gs ${nf(total)} al destinatario seleccionado?`)) return;

    setBusy(true);
    try {
      const ext = newReceipt.type === 'application/pdf' ? 'pdf' : newReceipt.type.split('/')[1];
      const path = `closure-pending/${userId}/${crypto.randomUUID()}.${ext}`;
      const { data: draft, error: draftError } = await supabase
        .from('delivery_closure_recovery' as any)
        .insert({
          delivery_user_id: userId,
          destination_user_id: destination,
          order_ids: selected.map(o => o.id),
          receipt_path: path,
          status: 'PREPARADO',
        })
        .select('*')
        .single();
      if (draftError) throw draftError;

      const { error: uploadError } = await supabase.storage.from('financial-receipts').upload(path, newReceipt, {
        contentType: newReceipt.type,
        upsert: false,
      });
      if (uploadError) {
        await supabase.from('delivery_closure_recovery' as any).update({ last_error: 'Falló carga: ' + uploadError.message }).eq('id', (draft as any).id);
        throw uploadError;
      }

      await supabase.from('delivery_closure_recovery' as any).update({ status: 'ARCHIVO_CARGADO' }).eq('id', (draft as any).id);
      const { error } = await (supabase as any).rpc('submit_delivery_closure_with_receipt', {
        p_destination_user_id: destination,
        p_order_ids: selected.map(o => o.id),
        p_receipt_path: path,
      });
      if (error) {
        await supabase.from('delivery_closure_recovery' as any).update({ last_error: error.message }).eq('id', (draft as any).id);
        throw error;
      }

      await supabase.from('delivery_closure_recovery' as any).update({ status: 'COMPLETADO', last_error: null }).eq('id', (draft as any).id);
      toast.success('Cierre registrado con comprobante, pendiente de aprobación.');
      setNewReceipt(null);
      const remaining = selectedDestinations.filter(id => id !== destination);
      setSelectedDestinations(remaining);
      setDestination(remaining[0] || '');
      await reload();
      document.getElementById('closure-submissions')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e: any) {
      toast.error(
        'No se registró el cierre: ' +
          (e.message || 'Error desconocido') +
          '. Revisá Recuperación de cierres antes de volver a subir el archivo.',
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const attach = async (id: string) => {
    const file = files[id];
    if (!file) {
      toast.error('Elegí un comprobante');
      return;
    }
    setBusy(true);
    try {
      const path = await upload('closure', id, file);
      const { error } = await supabase.rpc('attach_delivery_closure_receipt', { p_closure_id: id, p_path: path });
      if (error) throw error;
      toast.success('Comprobante enviado para revisión');
      await reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('reopen_rejected_delivery_closure', { p_closure_id: id });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success('Cierre reabierto; adjuntá nuevo comprobante');
      await reload();
    }
  };

  const review = async (id: string, approve: boolean) => {
    const reason = approve ? '' : prompt('Motivo del rechazo:') || '';
    if (!approve && !reason.trim()) return;
    if (approve && !confirm('¿Confirmás que recibiste el importe correcto? Se rendirán todos los pedidos del cierre.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('review_delivery_closure', {
      p_closure_id: id,
      p_approve: approve,
      p_reason: reason,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(approve ? 'Cierre aprobado. Pedidos rendidos.' : 'Cierre rechazado');
      await reload();
    }
  };

  const getSignedUrl = async (path: string) => {
    const { data, error } = await supabase.storage.from('financial-receipts').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Sin acceso al comprobante');
    return data.signedUrl;
  };

  const seeReceipt = async (path: string) => {
    try {
      const signedUrl = await getSignedUrl(path);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo abrir el comprobante');
    }
  };

  const previewReceipt = async (path: string) => {
    try {
      const signedUrl = await getSignedUrl(path);
      setPreview({ path, url: signedUrl, isPdf: isPdfPath(path) });
    } catch (e: any) {
      toast.error(e.message || 'No se pudo previsualizar el comprobante');
    }
  };

  return (
    <div className="closure-premium-panel app-card !p-4 my-4 space-y-5">
      <div className="closure-premium-receipts-header rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary/80 font-black">Cierres</p>
            <h4 className="text-xl font-black">🏦 Rendiciones con comprobantes</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Panel mejorado para cargar comprobantes, revisar cierres pendientes y controlar rendiciones de manera más clara.
            </p>
          </div>
          <button className="nav-btn active" onClick={reload}>
            🔄 Actualizar panel
          </button>
        </div>
      </div>

      {canOwnBank && view === 'config' && (
        <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-4 shadow-sm">
          <div className="flex items-center gap-3 pb-2 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-blue-500/15 flex items-center justify-center text-lg">🏦</div>
            <div>
              <h5 className="font-black text-base">
                {role === 'ADMIN' ? 'Configurar cuentas bancarias para cierres' : 'Mis datos bancarios para recibir cierres'}
              </h5>
              <p className="text-xs text-muted-foreground">Definí la cuenta que se mostrará en la rendición del delivery.</p>
            </div>
          </div>

          {role === 'ADMIN' && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-sm font-bold">Seleccioná todos los proveedores que usarán esta cuenta bancaria</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="nav-btn" onClick={() => setSelectedProviderIds(providers.map(p => p.user_id))}>
                  Seleccionar todos ({providers.length})
                </button>
                <button type="button" className="nav-btn" onClick={() => setSelectedProviderIds([])}>
                  Limpiar selección
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border p-3 space-y-2 bg-background/40">
                {providers.length === 0 && <p className="text-xs text-muted-foreground">No se encontraron proveedores aprobados.</p>}
                {providers.map(p => (
                  <label key={p.user_id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedProviderIds.includes(p.user_id)}
                      onChange={e =>
                        setSelectedProviderIds(old => (e.target.checked ? [...old, p.user_id] : old.filter(id => id !== p.user_id)))
                      }
                    />
                    <span>
                      {p.name || p.email || 'Proveedor'} {p.email ? `— ${p.email}` : ''}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex gap-2 items-center text-sm">
                <input type="checkbox" checked={applyToOwnAccount} onChange={e => setApplyToOwnAccount(e.target.checked)} />
                Incluir también mi cuenta de administrador
              </label>
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs space-y-1">
                <p className="font-bold text-amber-300">
                  Seleccionados: {selectedProviderIds.length + (applyToOwnAccount ? 1 : 0)} destinatario(s)
                </p>
                <p className="text-muted-foreground">
                  Se copiarán los mismos datos a cada proveedor marcado. Los proveedores no seleccionados conservan su cuenta actual.
                </p>
                <p className="text-amber-200">Si un proveedor ya tiene datos guardados, serán reemplazados por estos datos.</p>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <input className="app-input" placeholder="Banco" value={bank.bank_name} onChange={e => setBank({ ...bank, bank_name: e.target.value })} />
            <input className="app-input" placeholder="Número de cuenta" value={bank.bank_account} onChange={e => setBank({ ...bank, bank_account: e.target.value })} />
            <input className="app-input" placeholder="Titular" value={bank.bank_holder} onChange={e => setBank({ ...bank, bank_holder: e.target.value })} />
            <input className="app-input" placeholder="CI del titular (opcional)" value={bank.bank_ci} onChange={e => setBank({ ...bank, bank_ci: e.target.value })} />
            <input className="app-input md:col-span-2" placeholder="Alias bancario (opcional)" value={bank.bank_alias} onChange={e => setBank({ ...bank, bank_alias: e.target.value })} />
          </div>

          <button className="nav-btn active" disabled={busy} onClick={saveBank}>
            {role === 'ADMIN'
              ? `Guardar para ${selectedProviderIds.length + (applyToOwnAccount ? 1 : 0)} destinatario(s)`
              : 'Guardar mis datos bancarios'}
          </button>
        </section>
      )}

      {isDelivery && view === 'pagos' && (
        <section className={`rounded-2xl border p-4 space-y-3 shadow-sm ${dayClosure ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center text-lg">📅</div>
              <div>
                <h5 className="font-black text-base">Finalicé mi día · {dayLabel(today)}</h5>
                <p className="text-xs text-muted-foreground">
                  Obligatorio. Reportá todos tus pedidos de hoy y finalizá: los no entregados (menos DEVUELTO A DEPÓSITO) pasan al {dayLabel(nextBusinessDay(today))}.
                </p>
              </div>
            </div>
            {dayClosure ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">
                ✅ Finalizado {new Date(dayClosure.finalized_at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })} · {dayClosure.moved} pasaron al {dayLabel(dayClosure.next_day)}
              </span>
            ) : (
              <button
                type="button"
                className="nav-btn active"
                disabled={finalizing || dayOrders.length === 0}
                onClick={() => void finalizeDay()}
              >
                {finalizing ? 'Finalizando...' : dayOrders.length === 0 ? 'Sin pedidos hoy' : '✅ Finalicé mi día'}
              </button>
            )}
          </div>

          {dayOrders.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-background/40 p-2"><div className="text-[11px] text-muted-foreground">Pedidos de hoy</div><div className="text-xl font-black">{dayOrders.length}</div></div>
                <div className="rounded-xl bg-background/40 p-2"><div className="text-[11px] text-muted-foreground">Entregados</div><div className="text-xl font-black text-emerald-300">{dayOrders.filter(o => ['ENTREGADO', 'ENCOMIENDA ENTREGADA'].includes(String(o.status || '').toUpperCase())).length}</div></div>
                <div className="rounded-xl bg-background/40 p-2"><div className="text-[11px] text-muted-foreground">Sin reportar</div><div className="text-xl font-black text-rose-300">{dayOrders.filter(o => isUnreported(o.status)).length}</div></div>
                <div className="rounded-xl bg-background/40 p-2"><div className="text-[11px] text-muted-foreground">Pasan al siguiente día</div><div className="text-xl font-black text-violet-300">{dayOrders.filter(o => !staysOnDay(o.status)).length}</div></div>
              </div>
              {!dayClosure && dayOrders.some(o => isUnreported(o.status)) && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs">
                  <b>Te falta reportar:</b>{' '}
                  {dayOrders.filter(o => isUnreported(o.status)).map(o => `#${o.day_seq || '?'} ${o.customer_name || o.order_number || ''} (${o.status || 'sin estado'})`).join(' · ')}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {isDelivery && view === 'pagos' && (
        <section className="rounded-2xl border border-border bg-card/70 p-4 space-y-4 shadow-sm">
          <div className="flex items-center gap-3 pb-2 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-lg">🚚</div>
            <div>
              <h5 className="font-black text-base">Rendición — pago a proveedores</h5>
              <p className="text-xs text-muted-foreground">
                Elegí el proveedor, verificá la cuenta bancaria y cargá el comprobante. Todos los pedidos elegibles del proveedor se incluyen automáticamente.
              </p>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold">1. Seleccionar uno o varios proveedores</label>
                <p className="text-xs text-muted-foreground">Marcá los proveedores a rendir. Después abrí uno por vez para revisar sus pedidos y adjuntar el comprobante de esa transferencia.</p>
                <div className="rounded-2xl border border-border bg-background/30 p-3 space-y-3">
                  <input
                    className="app-input w-full"
                    aria-label="Buscar proveedor por nombre o correo"
                    placeholder="🔎 Buscar proveedor por nombre o correo..."
                    value={providerSearch}
                    onChange={e => setProviderSearch(e.target.value)}
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="font-bold">{selectedDestinations.length} proveedor(es) marcado(s)</span>
                    <button type="button" className="nav-btn !py-1" onClick={() => { setSelectedDestinations([]); setDestination(''); setNewReceipt(null); }}>Limpiar selección</button>
                  </div>
                  <div className="max-h-56 overflow-auto space-y-2">
                    {catalog.filter(b => `${b.owner_name || ''} ${b.owner_email || ''} ${b.bank_name || ''}`.toLowerCase().includes(providerSearch.toLowerCase())).map(b => {
                      const id = String(b.owner_user_id);
                      const marked = selectedDestinations.includes(id);
                      return (
                        <label key={id} className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3 cursor-pointer">
                          <input
                            className="mt-1"
                            type="checkbox"
                            checked={marked}
                            onChange={e => {
                              const next = e.target.checked ? [...selectedDestinations, id] : selectedDestinations.filter(value => value !== id);
                              setSelectedDestinations(next);
                              if (e.target.checked && !destination) { setDestination(id); setNewReceipt(null); }
                              if (!e.target.checked && destination === id) { setDestination(next[0] || ''); setNewReceipt(null); }
                            }}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold break-words">{b.owner_name || b.owner_email || 'Proveedor'}</span>
                            <span className="block text-xs text-muted-foreground break-all">{b.owner_email || ''} · {b.bank_name || ''}</span>
                          </span>
                        </label>
                      );
                    })}
                    {catalog.length > 0 && !catalog.some(b => `${b.owner_name || ''} ${b.owner_email || ''} ${b.bank_name || ''}`.toLowerCase().includes(providerSearch.toLowerCase())) && <p className="text-xs text-muted-foreground">No se encontraron proveedores con esa búsqueda.</p>}
                  </div>
                </div>
                {selectedDestinations.length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-3">
                    <div className="font-black text-sm">Proveedor que vas a rendir ahora</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {catalog.filter(b => selectedDestinations.includes(String(b.owner_user_id))).map(b => {
                        const id = String(b.owner_user_id);
                        const active = destination === id;
                        return <button
                          key={id}
                          type="button"
                          onClick={() => { if (!active) { setDestination(id); setNewReceipt(null); } }}
                          className={`rounded-xl border p-3 text-left text-sm transition-colors ${active ? 'border-cyan-400 bg-cyan-500/20 font-black' : 'border-border bg-card/50 hover:bg-muted/60'}`}
                        >
                          <span className="block break-words">{active ? '● ' : '○ '}{b.owner_name || b.owner_email}</span>
                          <span className="block text-xs text-muted-foreground mt-1">{b.bank_name} · {active ? 'Cierre actual' : 'Abrir cierre'}</span>
                        </button>;
                      })}
                    </div>
                    <p className="text-xs text-amber-300">Cada proveedor genera un cierre independiente. Se requiere el comprobante de la transferencia correspondiente. No combines cuentas distintas en un único comprobante.</p>
                  </div>
                )}
                {catalogError && <p className="text-sm text-red-600" role="alert">{catalogError}</p>}
                {!catalogError && catalog.length === 0 && (
                  <p className="text-sm text-amber-700">
                    No hay proveedores con cuenta bancaria disponible. El administrador debe asignar datos bancarios a cada proveedor desde Cierres.
                  </p>
                )}
              </div>

              {dest && (
                <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-base">2. Datos bancarios para transferir</strong>
                    {dest.bank_alias && (
                      <button
                        className="nav-btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(dest.bank_alias);
                          toast.success('Alias copiado');
                        }}
                      >
                        Copiar alias
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="rounded-xl bg-background/40 p-3"><span className="text-xs text-muted-foreground">Titular</span><div className="font-extrabold">{dest.bank_holder}</div></div>
                    <div className="rounded-xl bg-background/40 p-3"><span className="text-xs text-muted-foreground">Banco</span><div className="font-extrabold">{dest.bank_name}</div></div>
                    <div className="rounded-xl bg-background/40 p-3"><span className="text-xs text-muted-foreground">Cuenta</span><div className="font-extrabold break-all">{dest.bank_account}</div></div>
                    <div className="rounded-xl bg-background/40 p-3"><span className="text-xs text-muted-foreground">CI / Alias</span><div className="font-extrabold break-all">{dest.bank_ci || '—'} {dest.bank_alias ? `· ${dest.bank_alias}` : ''}</div></div>
                  </div>
                </div>
              )}

              {dest && eligible.length === 0 && (
                <p className="text-sm text-amber-700 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                  No se encontraron pedidos entregados, sin rendir y asignados a este delivery para el proveedor seleccionado.
                </p>
              )}

              {dest && eligible.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h6 className="font-black text-sm">3. Pedidos incluidos obligatoriamente</h6>
                    <span className="rounded-full px-3 py-1 text-xs font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                      {selected.length} de {eligible.length}
                    </span>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-2xl border border-border bg-background/30 divide-y divide-border">
                    {eligible.map(o => {
                      const info = feeInfo(o);
                      const collectedAmount = o.status === 'ENTREGADO' ? Number(o.total_gs || 0) : 0;
                      const net = collectedAmount - info.fee;
                      return (
                        <div key={o.id} className="flex items-start gap-3 p-3 text-sm">
                          <input type="checkbox" checked disabled aria-label="Pedido incluido obligatoriamente" className="mt-1" />
                          <div className="min-w-0 flex-1">
                            <div className="font-extrabold break-all">#{o.order_number || o.id.slice(0, 8)}</div>
                            <div className="text-xs text-muted-foreground">{o.status} · Ciudad: {o.city || '—'}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-black whitespace-nowrap">Gs {nf(net)}</div>
                            <div className="text-[11px] text-muted-foreground whitespace-nowrap">Tarifa: Gs {nf(info.fee)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="text-xs text-emerald-200 mb-1 font-bold">Total cobrado en pedidos normales</div>
                  <div className="text-2xl font-black">Gs {nf(collected)}</div>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <div className="text-xs text-amber-200 mb-1 font-bold">Ganancia del delivery</div>
                  <div className="text-2xl font-black">- Gs {nf(deliveryPay)}</div>
                </div>
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <div className="text-xs text-cyan-200 mb-1 font-bold">Monto neto a transferir</div>
                  <div className="text-3xl font-black">Gs {nf(Math.max(0, total))}</div>
                </div>
              </div>

              {orderLimitReached && <p className="text-sm text-red-600 rounded-xl border border-red-500/20 bg-red-500/10 p-3">Hay demasiados pedidos para procesar de una vez. Contactá al administrador: no se permitirá rendir solo una parte.</p>}
              {feesLoadError && <p className="text-sm text-red-600 rounded-xl border border-red-500/20 bg-red-500/10 p-3">{feesLoadError}</p>}
              {selectedMissingRate && <p className="text-sm text-red-600 rounded-xl border border-red-500/20 bg-red-500/10 p-3">Hay pedidos sin tarifa de delivery registrada para su ciudad. Configurá las tarifas antes del cierre.</p>}
              {total < 0 && <p className="text-sm text-red-600 rounded-xl border border-red-500/20 bg-red-500/10 p-3">La ganancia del delivery supera el dinero cobrado. Este cierre no puede generar una transferencia negativa; debe resolverse el saldo con administración.</p>}

              <div className="rounded-2xl border border-border bg-background/30 p-4 space-y-3">
                <div>
                  <h6 className="font-black text-sm">4. Comprobante de transferencia</h6>
                  <p className="text-xs text-muted-foreground mt-1">
                    El servidor verificará las tarifas y recalculará el neto. En encomiendas entregadas no se suma el valor del pedido; solo se descuenta la tarifa.
                  </p>
                </div>
                <input
                  id="closure-new-receipt"
                  className="block w-full text-sm"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    if (f && !validFile(f)) {
                      toast.error('Solo JPG, PNG, WEBP o PDF hasta 8 MB');
                      setNewReceipt(null);
                      e.target.value = '';
                      return;
                    }
                    setNewReceipt(f);
                  }}
                />
                <div className="rounded-xl bg-muted/40 p-3 text-xs">
                  {newReceipt ? `Archivo listo: ${newReceipt.name}` : 'Todos los pedidos del proveedor están incluidos. Transferí el monto neto y adjuntá el comprobante antes de finalizar.'}
                </div>
                <button
                  className="nav-btn active !w-full"
                  disabled={dayPending || busy || !selected.length || !newReceipt || Boolean(feesLoadError) || selectedMissingRate || total < 0 || orderLimitReached}
                  onClick={submit}
                >
                  {busy ? 'Enviando cierre...' : dayPending ? '🔒 Primero finalizá tu día (paso de arriba)' : '✅ Enviar rendición con comprobante'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {(isDelivery || role === 'ADMIN') && view === 'pagos' && (
        <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-3 pb-2 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-violet-500/15 flex items-center justify-center text-lg">🛟</div>
            <div>
              <h5 className="font-black text-base">Recuperación de cierres incompletos</h5>
              <p className="text-xs text-muted-foreground">Estos registros no son pagos aprobados ni pedidos rendidos. El reintento vuelve a validar pedidos y monto en Supabase.</p>
            </div>
          </div>

          {recovery.filter(d => d.status !== 'COMPLETADO').length === 0 && <p className="text-sm">Sin intentos incompletos registrados desde esta actualización.</p>}
          {recovery.filter(d => d.status !== 'COMPLETADO').map(d => (
            <div key={d.id} className="rounded-xl border border-border p-3 text-sm space-y-2 bg-background/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{new Date(d.created_at).toLocaleString('es-PY')}</p>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusStyles(d.status === 'COMPLETADO' ? 'APROBADO' : d.status === 'PREPARADO' ? 'PENDIENTE' : 'RECHAZADO')}`}>{d.status}</span>
              </div>
              <p>Pedidos declarados: {d.order_ids?.length || 0} · Destinatario: {d.destination_user_id}</p>
              {d.last_error && <p className="text-red-600 break-words">Error: {d.last_error}</p>}
              {d.delivery_user_id === userId && (
                <button type="button" className="nav-btn active" disabled={busy || d.status === 'PREPARADO'} onClick={() => finishRecovery(d)}>
                  Reintentar registro con el mismo comprobante
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {role === 'ADMIN' && view === 'pagos' && (
        <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-3 pb-2 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-orange-500/15 flex items-center justify-center text-lg">🔎</div>
            <div>
              <h5 className="font-black text-base">Comprobantes sin cierre asociado — conciliación</h5>
              <p className="text-xs text-amber-700">Verificá manualmente transferencia, monto, destinatario y pedidos antes de cualquier ajuste.</p>
            </div>
          </div>
          {orphans.length === 0 && <p className="text-sm">No se encontraron archivos sueltos.</p>}
          {orphans.map(o => (
            <div key={o.receipt_path} className="rounded-xl border border-border p-3 text-sm space-y-2 bg-background/30">
              <p className="font-bold">{o.delivery_email || o.delivery_user_id || 'Sin identificar'}</p>
              <p className="text-xs text-muted-foreground">{new Date(o.uploaded_at).toLocaleString('es-PY')}</p>
              <p className="text-xs break-all">{o.receipt_path}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="nav-btn" onClick={() => previewReceipt(o.receipt_path)}>Vista previa</button>
                <button type="button" className="nav-btn active" onClick={() => seeReceipt(o.receipt_path)}>Abrir</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {view === 'historial' && <section id="closure-submissions" className="rounded-2xl border border-border bg-card/60 p-4 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-2 border-b border-border">
          <div>
            <h5 className="font-black text-base">📋 Cierres y comprobantes</h5>
            <p className="text-xs text-muted-foreground">Historial mejorado con filtros, KPI rápidos y acciones de vista previa.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`nav-btn ${historyStatusFilter === 'TODOS' ? 'active' : ''}`} onClick={() => setHistoryStatusFilter('TODOS')}>Todos ({historyKpis.totalCount})</button>
            <button className={`nav-btn ${historyStatusFilter === 'PENDIENTE' ? 'active' : ''}`} onClick={() => setHistoryStatusFilter('PENDIENTE')}>Pendientes ({historyKpis.pending})</button>
            <button className={`nav-btn ${historyStatusFilter === 'APROBADO' ? 'active' : ''}`} onClick={() => setHistoryStatusFilter('APROBADO')}>Aprobados ({historyKpis.approved})</button>
            <button className={`nav-btn ${historyStatusFilter === 'RECHAZADO' ? 'active' : ''}`} onClick={() => setHistoryStatusFilter('RECHAZADO')}>Rechazados ({historyKpis.rejected})</button>
          </div>
        </div>

        <div className="closure-premium-status-grid grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4"><div className="text-xs text-blue-200 font-bold">Total de cierres</div><div className="text-2xl font-black">{historyKpis.totalCount}</div></div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4"><div className="text-xs text-amber-200 font-bold">Pendientes</div><div className="text-2xl font-black">{historyKpis.pending}</div></div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"><div className="text-xs text-emerald-200 font-bold">Aprobados</div><div className="text-2xl font-black">{historyKpis.approved}</div></div>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4"><div className="text-xs text-red-200 font-bold">Rechazados</div><div className="text-2xl font-black">{historyKpis.rejected}</div></div>
        </div>

        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <input
            className="app-input"
            placeholder="Buscar por delivery, destinatario, ID o motivo..."
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
          />
          <button className="nav-btn" onClick={() => setHistorySearch('')}>Limpiar búsqueda</button>
        </div>

        {filteredHistory.length === 0 && <p className="text-sm text-muted-foreground">No hay cierres que coincidan con el filtro actual.</p>}

        <div className="space-y-3">
          {filteredHistory.map(c => (
            <div key={c.id} className="rounded-2xl border border-border p-4 space-y-3 text-sm bg-background/30">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-black text-base">Cierre {c.id.slice(0, 8)} · Gs {nf(Number(c.amount_gs || 0))}</div>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(c.created_at).toLocaleString('es-PY')}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-black ${getStatusStyles(c.status)}`}>
                  {c.status}
                  {!c.receipt_path && c.status === 'PENDIENTE' ? ' · Falta comprobante' : ''}
                </span>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Delivery</div>
                  <div className="font-bold break-all">{c.delivery_email}</div>
                </div>
                <div className="rounded-xl bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Destinatario</div>
                  <div className="font-bold break-all">{c.destination_email}</div>
                </div>
              </div>

              {c.rejection_reason && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                  <strong>Motivo del rechazo:</strong> {c.rejection_reason}
                </div>
              )}

              <div className="closure-premium-actions flex flex-wrap gap-2">
                {c.receipt_path && (
                  <>
                    <button className="nav-btn closure-preview-btn" onClick={() => previewReceipt(c.receipt_path)}>👁️ Abrir vista previa</button>
                    <button className="nav-btn active" onClick={() => seeReceipt(c.receipt_path)}>📄 Abrir</button>
                  </>
                )}

                {c.delivery_email.toLowerCase() === email.toLowerCase() && c.status === 'PENDIENTE' && !c.receipt_path && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={e => setFiles(old => ({ ...old, [c.id]: e.target.files?.[0] || null }))}
                    />
                    <button className="nav-btn active" disabled={busy || !files[c.id]} onClick={() => attach(c.id)}>
                      Subir comprobante y enviar
                    </button>
                  </div>
                )}

                {(role === 'ADMIN' || (role === 'PROVEEDOR' && c.destination_email.toLowerCase() === email.toLowerCase())) &&
                  c.status === 'PENDIENTE' &&
                  c.receipt_path && (
                    <>
                      <button className="nav-btn active" disabled={busy} onClick={() => review(c.id, true)}>
                        ✅ Aprobar y rendir pedidos
                      </button>
                      <button className="nav-btn" disabled={busy} onClick={() => review(c.id, false)}>
                        Rechazar
                      </button>
                    </>
                  )}

                {c.status === 'RECHAZADO' && c.delivery_email.toLowerCase() === email.toLowerCase() && (
                  <button className="nav-btn" disabled={busy} onClick={() => reopen(c.id)}>
                    Corregir comprobante y reenviar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>}

      {preview && (
        <div className="closure-preview-overlay fixed inset-0 z-[100] bg-black/80 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Vista previa del comprobante">
          <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-background border border-border shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
              <div className="min-w-0">
                <h6 className="font-black">Vista previa del comprobante</h6>
                <p className="text-xs text-muted-foreground break-all">{preview.path}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="nav-btn" onClick={() => { void seeReceipt(preview.path); }}>Abrir</button>
                <button className="nav-btn active" onClick={() => setPreview(null)}>Cerrar</button>
              </div>
            </div>
            <div className="flex-1 min-h-[55vh] bg-black/40 overflow-auto">
              {preview.isPdf ? (
                <iframe title="Vista previa del comprobante" src={preview.url} className="w-full h-[75vh]" />
              ) : (
                <img src={preview.url} alt="Comprobante" className="max-w-full mx-auto object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

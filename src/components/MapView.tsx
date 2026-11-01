import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const ASUNCION_CENTER: [number, number] = [-25.2867, -57.647];

interface DeliveryLoc {
  delivery_email: string;
  lat: number;
  lng: number;
  updated_at: string;
}

const LiveMapView = lazy(() => import('@/components/LiveMapView'));

export default function MapView() {
  const { profile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  if (role === 'ADMIN' || role === 'PROVEEDOR') {
    return (
      <Suspense fallback={<div className="p-6 text-muted-foreground">Cargando mapa…</div>}>
        <LiveMapView />
      </Suspense>
    );
  }
  return <DeliveryMapView />;
}

function DeliveryMapView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const myEmail = profile?.email || '';
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const [locations, setLocations] = useState<DeliveryLoc[]>([]);
  const [sharing, setSharing] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});

  // Load contact names
  useEffect(() => {
    supabase.from('profiles').select('email, name').eq('approved', true).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach(p => { m[p.email.toLowerCase()] = p.name || p.email; });
      setContacts(m);
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current).setView(ASUNCION_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);
    mapInstance.current = map;

    return () => { map.remove(); mapInstance.current = null; };
  }, []);

  // Load locations
  const loadLocations = async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data } = await supabase.from('delivery_locations').select('*')
      .gte('updated_at', fiveMinAgo);
    setLocations(data || []);
  };

  useEffect(() => { loadLocations(); }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel('delivery-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_locations' }, () => {
        loadLocations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Poll fallback every 15s
  useEffect(() => {
    const iv = setInterval(loadLocations, 15000);
    return () => clearInterval(iv);
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const currentEmails = new Set(locations.map(l => l.delivery_email.toLowerCase()));

    // Remove old markers
    markersRef.current.forEach((marker, email) => {
      if (!currentEmails.has(email)) {
        map.removeLayer(marker);
        markersRef.current.delete(email);
      }
    });

    // Add/update markers
    locations.forEach(loc => {
      const key = loc.delivery_email.toLowerCase();
      const name = contacts[key] || loc.delivery_email;
      const ago = Math.round((Date.now() - new Date(loc.updated_at).getTime()) / 1000);
      const agoText = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;

      const icon = L.divIcon({
        className: 'delivery-marker',
        html: `<div style="background:hsl(var(--primary));color:white;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);">🛵 ${name.split(' ')[0]}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (markersRef.current.has(key)) {
        const marker = markersRef.current.get(key)!;
        marker.setLatLng([loc.lat, loc.lng]);
        marker.setIcon(icon);
        marker.setPopupContent(`<b>${name}</b><br/>📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}<br/>⏰ Hace ${agoText}`);
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${name}</b><br/>📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}<br/>⏰ Hace ${agoText}`);
        markersRef.current.set(key, marker);
      }
    });
  }, [locations, contacts]);

  // Share location (DELIVERY only)
  const startSharing = () => {
    if (!navigator.geolocation) { toast.error('Tu navegador no soporta geolocalización'); return; }
    setSharing(true);
    toast.success('Compartiendo ubicación...');

    const sendLocation = async (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      // Upsert
      const { data: existing } = await supabase.from('delivery_locations').select('id')
        .eq('delivery_email', myEmail).limit(1);
      if (existing && existing.length > 0) {
        await supabase.from('delivery_locations').update({ lat, lng, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id);
      } else {
        await supabase.from('delivery_locations').insert({ delivery_email: myEmail, lat, lng });
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(sendLocation, (err) => {
      toast.error('Error GPS: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  };

  const stopSharing = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
    toast.info('Dejaste de compartir ubicación');
  };

  return (
    <div className="app-card">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-extrabold">🗺️ Mapa en tiempo real</h3>
        <div className="flex gap-2 items-center">
          <span className="chip text-[10px]">{locations.length} delivery activos</span>
          <span className="chip text-[10px]">Actualización cada 15s</span>
          {role === 'DELIVERY' && (
            sharing ? (
              <button className="nav-btn !bg-destructive/20 hover:!bg-destructive/40" onClick={stopSharing}>
                📍 Dejar de compartir
              </button>
            ) : (
              <button className="nav-btn active" onClick={startSharing}>
                📍 Compartir ubicación
              </button>
            )
          )}
        </div>
      </div>

      <div ref={mapRef} className="rounded-xl overflow-hidden border border-border" style={{ height: 520, width: '100%' }} />

      {locations.length > 0 && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {locations.map(loc => {
            const name = contacts[loc.delivery_email.toLowerCase()] || loc.delivery_email;
            const ago = Math.round((Date.now() - new Date(loc.updated_at).getTime()) / 1000);
            const agoText = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;
            return (
              <div key={loc.delivery_email} className="kpi-card !p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => mapInstance.current?.setView([loc.lat, loc.lng], 15)}>
                <div className="text-xs font-bold truncate">🛵 {name}</div>
                <div className="text-[10px] text-muted-foreground">Hace {agoText}</div>
              </div>
            );
          })}
        </div>
      )}

      {locations.length === 0 && (
        <div className="kpi-card mt-3 text-center py-6">
          <span className="text-3xl mb-2 block">📡</span>
          <p className="text-muted-foreground text-sm">Ningún delivery está compartiendo ubicación.</p>
          <p className="text-xs text-muted-foreground mt-1">Los delivery pueden activar el GPS desde esta pantalla.</p>
        </div>
      )}
    </div>
  );
}

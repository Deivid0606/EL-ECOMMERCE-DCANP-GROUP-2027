import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';

interface UserProfile {
  email: string;
  name: string | null;
  role: string | null;
  approved: boolean;
  user_id: string;
  sheet_url: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string, role: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// No confiar en perfiles persistidos: el rol/approved del usuario puede
// haber sido revocado desde otro dispositivo mientras la sesión sigue activa.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const currentUserRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const fetchProfile = async (userId: string): Promise<void> => {
    const request = ++requestRef.current;
    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from('profiles').select('user_id,email,name,sheet_url').eq('user_id', userId).maybeSingle(),
        supabase.from('user_roles').select('role,approved').eq('user_id', userId).maybeSingle(),
      ]);
      if (request !== requestRef.current || currentUserRef.current !== userId) return;
      if (profileRes.error || roleRes.error) {
        console.warn('No fue posible verificar permisos del usuario:', profileRes.error || roleRes.error);
        // Sin verificación vigente, no exponer ninguna pantalla con datos.
        queryClient.clear();
        setProfile(null);
        return;
      }
      const data = profileRes.data;
      const role = roleRes.data;
      if (!data || !role) {
        queryClient.clear();
        setProfile(null);
        return;
      }
      if (role.approved !== true) queryClient.clear();
      setProfile({
        email: data.email,
        name: data.name,
        role: role.role || null,
        approved: role.approved === true,
        user_id: userId,
        sheet_url: (data as any).sheet_url || null,
      });
    } catch (error) {
      if (request === requestRef.current && currentUserRef.current === userId) {
        console.warn('Falló la validación de permisos:', error);
        queryClient.clear();
        setProfile(null);
      }
    }
  };

  const refreshProfile = async () => {
    if (currentUserRef.current) await fetchProfile(currentUserRef.current);
  };

  useEffect(() => {
    let active = true;
    try { localStorage.removeItem('dcanp-profile-cache'); } catch { /* storage disabled */ }
    const applySession = async (sessionUser: User | null) => {
      if (!active) return;
      const userId = sessionUser?.id || null;
      if (currentUserRef.current !== userId) {
        currentUserRef.current = userId;
        requestRef.current++;
        queryClient.clear();
        setProfile(null); // Cierra inmediatamente la vista anterior al cambiar usuario.
        setLoading(Boolean(userId));
      }
      setUser(sessionUser);
      if (!userId) { setLoading(false); return; }
      await fetchProfile(userId);
      if (active && currentUserRef.current === userId) setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        void applySession(null);
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Ejecutar fuera del callback de Auth para no bloquear sus operaciones.
        setTimeout(() => void applySession(session?.user || null), 0);
      }
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session?.user || null);
    });

    // Si el administrador desactiva la cuenta con la sesión abierta, el panel
    // deja de mostrar datos al actualizar el estado de aprobación.
    const checkAccess = () => {
      if (document.visibilityState === 'visible' && currentUserRef.current) {
        void fetchProfile(currentUserRef.current);
      }
    };
    const interval = window.setInterval(checkAccess, 20000);
    window.addEventListener('focus', checkAccess);
    document.addEventListener('visibilitychange', checkAccess);

    return () => {
      active = false;
      requestRef.current++;
      subscription.unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('focus', checkAccess);
      document.removeEventListener('visibilitychange', checkAccess);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  // ✅ FUNCIÓN CORREGIDA: No insertar manualmente en user_roles
  const signUp = async (email: string, password: string, name: string, role: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { 
        data: { 
          name,
          role: role  // El rol se envía en los metadatos
        } 
      },
    });

    if (error) return { error: error.message };
    
    // El trigger handle_new_user se encarga de crear el perfil y los roles
    // No insertar nada manualmente aquí
    
    return { error: null };
  };

  const signOut = async () => {
    currentUserRef.current = null;
    requestRef.current++;
    queryClient.clear();
    setProfile(null);
    setUser(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

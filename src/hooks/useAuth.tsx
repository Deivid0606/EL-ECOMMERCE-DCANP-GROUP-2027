import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

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

// El perfil se guarda en el dispositivo para mostrar la app al instante al
// volver a abrirla, aunque la red tarde o falle (la sesión de Supabase ya
// persiste en localStorage y se renueva sola).
const PROFILE_CACHE_KEY = 'dcanp-profile-cache';

const readCachedProfile = (userId?: string): UserProfile | null => {
  try {
    const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null') as UserProfile | null;
    return cached && (!userId || cached.user_id === userId) ? cached : null;
  } catch {
    return null;
  }
};

const writeCachedProfile = (profile: UserProfile | null) => {
  try {
    if (profile) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // Sin almacenamiento: sólo se pierde el arranque instantáneo.
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const setProfile = (next: UserProfile | null) => {
    setProfileState(next);
    writeCachedProfile(next);
  };

  // Reintenta ante errores de red: un corte momentáneo no debe mandar al login.
  const fetchProfile = async (userId: string, attempt = 0): Promise<void> => {
    const [profileRes, roleRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('user_roles').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    if (profileRes.error || roleRes.error) {
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * 2 ** attempt)));
        return fetchProfile(userId, attempt + 1);
      }
      return;
    }

    const profileData = profileRes.data;
    const roleData = roleRes.data;
    if (profileData) {
      setProfile({
        email: profileData.email,
        name: profileData.name,
        role: roleData?.role || null,
        approved: roleData?.approved || false,
        user_id: userId,
        sheet_url: (profileData as any).sheet_url || null,
      });
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    let active = true;

    const applySession = async (sessionUser: User | null) => {
      if (!active) return;
      if (!sessionUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setUser(sessionUser);
      const cached = readCachedProfile(sessionUser.id);
      if (cached) {
        // Arranque instantáneo con el perfil guardado; se actualiza en segundo plano.
        setProfileState(cached);
        setLoading(false);
        void fetchProfile(sessionUser.id);
      } else {
        await fetchProfile(sessionUser.id);
        if (active) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Sólo un cierre de sesión real borra el perfil; los refrescos de token no.
      if (event === 'SIGNED_OUT') {
        void applySession(null);
        return;
      }
      if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        setTimeout(() => void applySession(session.user), 0);
      } else if (session?.user) {
        setUser(session.user);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session?.user || null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
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
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
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

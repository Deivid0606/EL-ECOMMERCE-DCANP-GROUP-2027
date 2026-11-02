import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { lovable } from '@/integrations/lovable/index';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import AnimatedStars from './AnimatedStars';

interface AuthViewProps {
  onSuccess: () => void;
}

function redirectAfterLogin(onSuccess: () => void) {
  const pendingUrl = localStorage.getItem('pending_order_url');

  if (pendingUrl) {
    localStorage.removeItem('pending_order_url');
    window.location.href = pendingUrl;
    return;
  }

  onSuccess();
}

export default function AuthView({ onSuccess }: AuthViewProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regRole, setRegRole] = useState('seller');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!loginEmail || !loginPass) {
      toast.error('Completá email y contraseña');
      return;
    }

    setLoading(true);
    const { error } = await signIn(loginEmail, loginPass);
    setLoading(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('¡Bienvenido!');
    redirectAfterLogin(onSuccess);
  };

  const handleForgot = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast.error('Escribí tu email arriba y tocá de nuevo "¿Olvidaste tu contraseña?"');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?reset=1`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `📧 Si ${email} está registrado, te llega un email con un link para crear una contraseña nueva. Si no llega en unos minutos (revisá spam), pedile al administrador que te la cambie.`,
      { duration: 12000 },
    );
  };

  const handleRegister = async () => {
    if (!regName || !regEmail || !regPass) {
      toast.error('Completá todos los campos');
      return;
    }

    setLoading(true);
    const { error } = await signUp(regEmail, regPass, regName, regRole);
    setLoading(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Cuenta creada. Revisá tu email para confirmar.');
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);

    try {
      const pendingUrl = localStorage.getItem('pending_order_url');

      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: pendingUrl || window.location.origin,
      });

      if (result.error) {
        toast.error('Error al iniciar con Google');
        setLoading(false);
        return;
      }

      if (result.redirected) return;

      toast.success('¡Bienvenido!');
      redirectAfterLogin(onSuccess);
    } catch {
      toast.error('Error al iniciar con Google');
    }

    setLoading(false);
  };

  return (
    <div className="relative min-h-screen">
      <AnimatedStars />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-[400px]">
          <div className="mb-4 text-center">
            <div className="mb-2 flex justify-center">
              <img
                src="https://cdn.shopify.com/s/files/1/0885/3012/5095/files/Captura_de_pantalla_2026-01-12_023843.jpg?v=1768196352"
                alt="DCANP GROUP Logo"
                className="h-20 w-20 rounded-2xl object-cover"
              />
            </div>
            <h1 className="text-2xl font-bold text-white">DCANP Group</h1>
            <p className="mt-0.5 text-xs text-white/50">Plataforma de gestión</p>
          </div>

          <div className="mb-5 text-center">
            <h2 className="mb-2 text-3xl font-black tracking-tight text-white">
              🇵🇾 TU NEGOCIO ONLINE
            </h2>
            <div className="mx-auto mb-3 h-0.5 w-12 bg-white/30" />
            <p className="mx-auto max-w-[280px] text-xs leading-relaxed text-white/60">
              Unite a la red de dropshipping más grande de Paraguay
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/80 p-6 shadow-2xl backdrop-blur-md">
            {mode === 'login' ? (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Correo electrónico
                    </label>
                    <input
                      type="email"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="tu@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Contraseña
                    </label>
                    <input
                      type="password"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="**********"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                </div>

                <button
                  onClick={handleLogin}
                  disabled={loading}
                  className="mt-6 w-full rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 py-3 font-bold text-white shadow-lg transition-all hover:from-orange-600 hover:to-orange-700 disabled:opacity-50"
                >
                  {loading ? 'Ingresando...' : 'Iniciar sesión'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleForgot()}
                  disabled={loading}
                  className="mt-3 w-full text-center text-sm font-semibold text-orange-400 hover:underline disabled:opacity-50"
                >
                  ¿Olvidaste tu contraseña?
                </button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/15" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-black/80 px-3 text-white/50">O continuar con</span>
                  </div>
                </div>

                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/10 py-3 transition-colors hover:bg-white/20"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  <span className="font-medium text-white">Google</span>
                </button>

                <p className="mt-6 text-center text-sm text-white/50">
                  ¿No tienes cuenta?{' '}
                  <button
                    onClick={() => setMode('register')}
                    className="font-semibold text-orange-400 hover:underline"
                  >
                    Registrate
                  </button>
                </p>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Nombre
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="Tu nombre"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Correo electrónico
                    </label>
                    <input
                      type="email"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="tu@email.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Contraseña
                    </label>
                    <input
                      type="password"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="**********"
                      value={regPass}
                      onChange={(e) => setRegPass(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/70">
                      Rol
                    </label>
                    <select
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white transition-all focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      value={regRole}
                      onChange={(e) => setRegRole(e.target.value)}
                    >
                      <option value="seller" className="bg-black">VENDEDOR</option>
                      <option value="delivery" className="bg-black">DELIVERY</option>
                      <option value="despachante" className="bg-black">DESPACHANTE</option>
                      <option value="proveedor" className="bg-black">PROVEEDOR</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleRegister}
                  disabled={loading}
                  className="mt-5 w-full rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 py-3 font-bold text-white shadow-lg transition-all hover:from-orange-600 hover:to-orange-700 disabled:opacity-50"
                >
                  {loading ? 'Creando cuenta...' : 'Crear cuenta'}
                </button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/15" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-black/80 px-3 text-white/50">O continuar con</span>
                  </div>
                </div>

                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/10 py-3 transition-colors hover:bg-white/20"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  <span className="font-medium text-white">Google</span>
                </button>

                <p className="mt-6 text-center text-sm text-white/50">
                  ¿Ya tienes cuenta?{' '}
                  <button
                    onClick={() => setMode('login')}
                    className="font-semibold text-orange-400 hover:underline"
                  >
                    Iniciar sesión
                  </button>
                </p>
              </>
            )}
          </div>

          <p className="mt-5 text-center text-[10px] text-white/30">
            Plataforma de gestión de DCANP Group
          </p>
        </div>
      </div>
    </div>
  );
}

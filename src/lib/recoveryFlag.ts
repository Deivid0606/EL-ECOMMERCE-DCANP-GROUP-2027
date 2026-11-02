// Se importa primero en main.tsx: detecta el link de "recuperar contraseña"
// antes de que Supabase limpie la URL.
const KEY = 'dcanp_pw_recovery';
try {
  const h = window.location.hash || '';
  if (h.includes('type=recovery') || new URLSearchParams(window.location.search).get('reset') === '1') {
    sessionStorage.setItem(KEY, '1');
  }
} catch {
  /* sin storage */
}
export const isRecovering = () => {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
export const setRecovering = (on: boolean) => {
  try {
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* sin storage */
  }
};

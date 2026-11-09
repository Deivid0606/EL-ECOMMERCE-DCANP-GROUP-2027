import { supabase } from '@/integrations/supabase/client';

/**
 * Las fotos de la cámara del celular pesan varios MB y con señal débil la
 * subida se corta («Failed to fetch»). Antes de subir se achica la imagen
 * (sigue legible) y, si la conexión se corta, se reintenta.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
const COMPRESS_FROM = 500 * 1024;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= COMPRESS_FROM) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Extensión para el nombre del archivo en el almacenamiento. */
export const receiptExt = (file: File) => (file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] || 'jpg');

const isNetworkError = (msg: string) => /fetch|network|timeout|load failed|aborted|connection/i.test(msg);

/** Mensaje claro cuando la subida falla por la conexión. */
export const friendlyUploadError = (msg: string) =>
  isNetworkError(msg)
    ? 'No se pudo subir el comprobante: la conexión se cortó. Probá con mejor señal o Wi-Fi y volvé a intentar.'
    : msg;

/** Sube el archivo con hasta 3 intentos si la conexión se corta. */
export async function uploadReceipt(bucket: string, path: string, file: File, tries = 3) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (!error) return;
    // Si un intento anterior llegó aunque el celular no recibió la respuesta, el archivo ya está.
    if (/already exists|duplicate/i.test(error.message)) return;
    last = error;
    if (!isNetworkError(error.message)) break;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(friendlyUploadError(String(last?.message || 'Error al subir el archivo')));
}

# 📹 Sucursal: video remoto de iCSee/VMS

## Estado

La pestaña Sucursal, registro de cámaras y RLS por propietario ya existen.
Esta integración agrega un reproductor HLS autenticado, la función de validación
**branch-camera-auth** y un instalador local de MediaMTX para Windows.

**El video todavía NO aparece en producción hasta completar la instalación
en la PC y registrar un nombre de host HTTPS para el túnel en Vercel.**
No existe forma de llegar desde Vercel a una IP privada 192.168.x.x sin un
equipo con acceso a esa red o un servicio oficial de cámara.

## Paso 1 - Registrar la cámara en la plataforma

- Iniciar sesión con un usuario ADMIN o PROVEEDOR aprobado.
- Sucursal → Nueva cámara → colocar un nombre, la IP privada (por ejemplo
  192.168.18.26) y el puerto RTSP (554).
- Guardar; luego usar **Copiar ID** para copiar el identificador del canal.
- Nunca pegar contraseñas en la plataforma, en tickets o en GitHub.
- Cada persona solo puede registrar, ver y borrar sus propias cámaras.

## Paso 2 - Preparar la PC Windows encendida en la sucursal

- Descargar el script revisado desde `tools/sucursal/windows/setup-mediamtx.ps1`
  y abrirlo con PowerShell bajo el usuario local que lo ejecutará.
- El script pide el **ID de canal** y una URL RTSP **que funcione en VLC**.
  Escribir esa URL **solo en la PC**, no en ChatGPT ni en páginas públicas.
- Descarga MediaMTX v1.21.3 del repositorio oficial; comprueba SHA256 antes
  de extraer el binario; guarda la configuración en el perfil local de Windows.
- Deja el servidor escuchando **solo** en `127.0.0.1:8888` y con
  `authMethod: http` apuntando a la autorización remota de Supabase.
- Para comenzar una prueba, se abre el proceso MediaMTX en una ventana de
  PowerShell. Es necesario que el proceso permanezca corriendo. Para
  disponibilidad 24/7, configurar un inicio automático con privilegios
  adecuados o una tarea programada supervisada. Este paso **no** se realiza
  automáticamente por el script.

No se abren puertos del router; no usar reenvío 554, 8888 ni 34567.

## Paso 3 - Túnel HTTPS y hostname

1. Tener una cuenta autorizada y dominio gestionado en Cloudflare.
2. Crear un **Cloudflare Tunnel** administrado remotamente.
3. Definir un hostname dedicado, por ejemplo **camaras.TU-DOMINIO.com**,
   con destino **http://127.0.0.1:8888**.
4. Instalar y ejecutar el conector oficial cloudflared en Windows usando
   el token del túnel. El usuario realiza esta instalación en su PC; no
   colocar tokens en chats o repositorios. Cloudflare explica el comando
   `cloudflared.exe service install <TOKEN>`.
5. Crear en el proyecto Vercel **ecommerce20**, entorno de producción, la
   variable `VITE_BRANCH_CAMERA_HLS_BASE_URL` con exactamente la base
   HTTPS autorizada, por ejemplo `https://camaras.TU-DOMINIO.com`.
   Esto exige recompilar y publicar la app después de configurar la variable.
6. Restringir el acceso del hostname al **único** MediaMTX configurado con
   autorización externa. No usar un túnel que apunte a VMS, RTSP o puertos
   de administración.

El hostname no se puede suponer ni introducir aquí antes de crearlo.
La transmisión solo se habilita cuando Vercel tenga una URL HTTPS válida.

## Flujo de autorización

- En Sucursal, el reproductor usa `branch_cameras.stream_id` como
  nombre de path dentro de MediaMTX.
- La aplicación obtiene la sesión Supabase del usuario e incluye
  `Authorization: Bearer <token>` solo en solicitudes al hostname
  HTTPS fijado en `VITE_BRANCH_CAMERA_HLS_BASE_URL`.
- MediaMTX valida solicitudes HLS de lectura mediante
  `https://mnpbwoknqwsjtiyrrxbm.supabase.co/functions/v1/branch-camera-auth`.
- La función **branch-camera-auth** exige sesión válida y una cámara
  perteneciente al usuario aprobado con rol ADMIN o PROVEEDOR, gracias a RLS.
- La autorización se aplica a **cada ruta**, no basta con conocer un ID.
- El servidor no permite reproducciones anónimas. Si no se configura
  `authMethod: http` (o falla), no publicar el túnel.

## Revisión final antes de usar

- Comprobar visualmente conexión local MediaMTX y cámara en la misma red.
- Comprobar usuario sin sesión: acceso HLS devuelve **401/403**.
- Probar Proveedor A contra path de Proveedor B: **403**.
- Probar usuario ADMIN con su canal: reproducción autorizada.
- Probar la app desde datos móviles sin WiFi.
- Confirmar que no hay credenciales en URLs, historial del navegador ni logs.
- Activar protección adicional del host de Cloudflare si el caso lo requiere.
- Los formatos de video pueden requerir re-encoding si la cámara usa codec
  no compatible con navegador (MediaMTX no garantiza transcodificación).
- HLS tiene más latencia que RTSP y puede no funcionar en iOS antiguo.
- Programar actualizaciones de MediaMTX y cloudflared.

## Fuentes oficiales

- MediaMTX: https://mediamtx.org/docs/features/authentication
- MediaMTX web/HLS: https://mediamtx.org/docs/read/web-browsers
- Instalación: https://mediamtx.org/docs/kickoff/install
- Cloudflare: https://developers.cloudflare.com/tunnel/get-started/

(async () => {
  const MARK = 'DCANP_DROPI:';
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const vis = (el) => !!(el && el.getClientRects().length);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toast = (html, ms) => {
    const old = document.getElementById('dcanp-dropi-msg');
    if (old) old.remove();
    const b = document.createElement('div');
    b.id = 'dcanp-dropi-msg';
    b.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;background:#111827;color:#fff;padding:14px 16px;border-radius:14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);border:2px solid #f97316';
    b.innerHTML = html + '<div style="margin-top:6px;opacity:.6;font-size:11px">DCANP · tocá para cerrar</div>';
    b.onclick = () => b.remove();
    document.body.appendChild(b);
    if (ms) setTimeout(() => b.remove(), ms);
  };
  let txt = '';
  try { txt = await navigator.clipboard.readText(); } catch (e) {}
  if (!txt || txt.indexOf(MARK) !== 0) txt = prompt('Pegá acá los datos copiados desde DCANP (Ctrl+V):') || '';
  if (txt.indexOf(MARK) !== 0) { toast('⚠️ No encontré datos de DCANP. En la app tocá <b>🟠 Cargar a Dropi</b> y después volvé a tocar este botón.', 9000); return; }
  let d;
  try { d = JSON.parse(txt.slice(MARK.length)); } catch (e) { toast('⚠️ Los datos copiados están incompletos. Copialos otra vez desde la app.', 8000); return; }

  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    ['input', 'change', 'keyup', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  };
  const inputs = () => [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].filter(vis);
  const byPh = (...ps) => inputs().find((i) => ps.some((p) => norm(i.placeholder).includes(norm(p))));
  const byLabel = (label) => {
    const els = [...document.querySelectorAll('label,span,p,div,small')].filter((e) => vis(e) && e.children.length === 0 && norm(e.textContent) === norm(label));
    for (const e of els) {
      let p = e.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const inp = [...p.querySelectorAll('input')].find(vis);
        if (inp) return inp;
      }
    }
    return null;
  };
  const ok = [], miss = [];
  const fill = (name, el, v) => {
    if (v === undefined || v === null || v === '') return;
    if (el) { setVal(el, v); ok.push(name); } else miss.push(name);
  };

  if (!byPh('Nombres')) {
    const search = inputs().find((i) => /buscar|search|producto|nombre o id/.test(norm(i.placeholder)));
    if (d.dropiId && search) {
      setVal(search, d.dropiId);
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
    toast('🔎 Busqué el producto <b>' + (d.dropiId || d.product || '') + '</b>.<br>Abrí <b>Enviar a cliente / Crear Orden</b> de ese producto y volvé a tocar <b>Llenar Dropi</b>.', 12000);
    return;
  }

  fill('Nombres', byPh('Nombres'), d.firstName);
  fill('Apellidos', byPh('Apellidos'), d.lastName);
  fill('Teléfono', byPh('telefono', 'teléfono', 'celular'), d.phone);
  fill('Dirección', byPh('Direccion', 'Dirección'), d.address);
  fill('Correo', byPh('Correo', 'email'), d.email);
  fill('Cantidad', byLabel('Cantidad'), d.qty);
  fill('Precio de venta', byLabel('Precio de venta'), d.unitPrice);

  const pick = async (ph, value) => {
    if (!value) return false;
    const want = norm(value);
    const match = (list) => list.find((o) => norm(o.textContent || o.text) === want) || list.find((o) => norm(o.textContent || o.text).includes(want)) || list.find((o) => want.includes(norm(o.textContent || o.text)) && norm(o.textContent || o.text).length > 3);
    const sel = [...document.querySelectorAll('select')].filter(vis).find((s) => [s.getAttribute('aria-label'), s.name, s.id, s.options[0] && s.options[0].text].some((t) => norm(t).includes(norm(ph))));
    if (sel) {
      const o = match([...sel.options]);
      if (!o) return false;
      sel.value = o.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(700);
      return true;
    }
    const trig = [...document.querySelectorAll('input,div,span,button')].filter(vis).find((e) => (e.placeholder && norm(e.placeholder) === norm(ph)) || (e.children.length === 0 && norm(e.textContent) === norm(ph)));
    if (!trig) return false;
    trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trig.click();
    if (trig.focus) trig.focus();
    await sleep(500);
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT') { setVal(a, value); await sleep(700); }
    const opts = [...document.querySelectorAll('[role=option],li,.ng-option,mat-option,.dropdown-item,.option')].filter(vis);
    const o = match(opts);
    if (o) { o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); o.click(); await sleep(800); return true; }
    document.body.click();
    return false;
  };
  (await pick('Departamento', d.department)) ? ok.push('Departamento') : d.department && miss.push('Departamento (' + d.department + ')');
  (await pick('Ciudad', d.city)) ? ok.push('Ciudad') : d.city && miss.push('Ciudad (' + d.city + ')');

  toast('✅ Llené: ' + ok.join(', ') + (miss.length ? '<br>✋ Completá vos: <b>' + miss.join(', ') + '</b>' : '') + '<br>Revisá, elegí la <b>transportadora</b> y tocá <b>Enviar al cliente</b>.' + (d.notes ? '<br>📝 Nota: ' + String(d.notes).replace(/</g, '&lt;') : ''), 0);
})();

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

  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const r = fn();
      if (r) return r;
      await sleep(300);
    }
    return null;
  };
  const sendButtons = () =>
    [...document.querySelectorAll('button,a,[role=button]')].filter((b) => vis(b) && /enviar a(l)? cliente|crear orden/.test(norm(b.textContent)));

  if (!byPh('Nombres')) {
    const term = String(d.dropiSearch || d.dropiId || d.product || '').trim();
    const termN = norm(term);
    const isId = /^\d+$/.test(term);
    // Tarjeta del producto: la que menciona el ID o el nombre buscado.
    const findCardButton = () => {
      const btns = sendButtons();
      if (!btns.length) return null;
      const scored = btns.map((b) => {
        let card = b;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          if (norm(card.textContent).length > 40) break;
        }
        const t = norm(card.textContent);
        let score = 0;
        if (isId && new RegExp('(id|#)\\W*' + term + '\\b').test(t)) score = 3;
        else if (termN && t.includes(termN)) score = 2;
        else if (termN) score = termN.split(' ').filter((w) => w.length > 3 && t.includes(w)).length / 10;
        return { b, score };
      });
      scored.sort((x, y) => y.score - x.score);
      return scored[0].score > 0 ? scored[0].b : null;
    };

    let btn = findCardButton();
    if (!btn && term) {
      const search = inputs().find((i) => /buscar|busca|search|producto|que estas buscando|nombre o id/.test(norm(i.placeholder)));
      if (search) {
        search.focus();
        setVal(search, term);
        ['keydown', 'keypress', 'keyup'].forEach((t) => search.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
        if (search.form && search.form.requestSubmit) { try { search.form.requestSubmit(); } catch (e) {} }
        const near = search.parentElement && [...search.parentElement.parentElement.querySelectorAll('button')].find(vis);
        if (near && !/enviar/.test(norm(near.textContent))) near.click();
        toast('🔎 Buscando <b>' + term.replace(/</g, '&lt;') + '</b> en Dropi…', 0);
        btn = await waitFor(findCardButton, 10000);
      }
    }
    if (!btn) {
      toast('⚠️ No encontré el producto <b>' + (term || '').replace(/</g, '&lt;') + '</b> en esta página.<br>Buscalo vos en Dropi, tocá <b>Enviar a cliente</b> y volvé a tocar <b>Llenar Dropi</b>.<br><small>Tip: en la app poné el <b>nombre exacto</b> del producto como aparece en Dropi.</small>', 0);
      return;
    }
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    toast('📦 Abriendo el formulario…', 0);
    const ok = await waitFor(() => byPh('Nombres'), 10000);
    if (!ok) {
      toast('⚠️ Se tocó <b>Enviar a cliente</b> pero no apareció el formulario. Abrilo vos y volvé a tocar <b>Llenar Dropi</b>.', 0);
      return;
    }
    await sleep(600);
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

import { Engine, fmtKm, fmtEstaca, FLAG_SRE, FLAG_MUN } from './engine.js';
import { db } from './db.js';
import { stampPhoto, buildPackage, dataHora } from './export.js';

const $ = (s) => document.querySelector(s);
const APP_VERSION = '1.0.0';

const TIPOS = ['Pavimento', 'Acostamento', 'Drenagem', 'Sinalização horizontal', 'Sinalização vertical',
  'Defensas / Segurança', 'Roçada / Vegetação', 'Faixa de domínio', 'Talude / Erosão / Queda de barreira',
  'OAE (ponte / viaduto)', 'Limpeza / Entulho', 'Acidente / Ocorrência', 'Serviço em execução', 'Outros'];
const LADOS = ['LD', 'LE', 'Eixo', 'Ambos'];
const GRAVS = ['Baixa', 'Média', 'Alta'];
const SIT = { PAV: 'Pavimentada', NPV: 'Não pavimentada', DUP: 'Pista dupla', EOD: 'Em obras de duplicação', EOP: 'Em obras de pavimentação', PLA: 'Planejada' };

let engine = null;
const cfg = { nome: '', lote: '', formato: 'km', tema: 'claro', tela: true };
const st = {
  fix: null, prevFix: null, loc: null, lastLine: null, crescente: null, sentidoManual: false,
  watchId: null, demo: null, wake: null,
};

// ---------------------------------------------------------------- utilidades
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const titulo = (s) => (s || '').toLowerCase().replace(/(^|[\s(/-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());

// ---------------------------------------------------------------- navegação (botão voltar do Android)
const pilha = [];
function abrir(id) {
  const doMenu = !$('#menu').hidden;
  if (doMenu) { $('#menu').hidden = true; $('#menuScrim').hidden = true; }
  if (pilha[pilha.length - 1] === id) return;
  const el = $('#tela-' + id); if (!el) return;
  el.hidden = false; pilha.push(id);
  if (doMenu) history.replaceState({ tela: id }, ''); else history.pushState({ tela: id }, '');
  if (id === 'lista') renderLista();
  if (id === 'exportar') renderExportar();
  if (id === 'config') renderConfig();
  if (id === 'sobre') renderSobre();
}
function fecharTopo() {
  const id = pilha.pop(); if (id) $('#tela-' + id).hidden = true;
  if (id === 'config') salvarConfig();
}
window.addEventListener('popstate', () => {
  if (!$('#menu').hidden) { fecharMenu(true); return; }
  fecharTopo();
});
function voltar() { history.back(); }
document.querySelectorAll('.voltar').forEach((b) => b.addEventListener('click', voltar));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => abrir(b.dataset.go)));

function abrirMenu() { $('#menu').hidden = false; $('#menuScrim').hidden = false; history.pushState({ menu: 1 }, ''); }
function fecharMenu(fromPop) {
  if ($('#menu').hidden) return;
  $('#menu').hidden = true; $('#menuScrim').hidden = true;
  if (!fromPop) history.replaceState(null, '');
}
$('#btnMenu').onclick = abrirMenu;
$('#menuScrim').onclick = () => history.back();

// ---------------------------------------------------------------- configurações
async function carregarConfig() {
  Object.assign(cfg, await db.get('cfg', {}));
  aplicarTema();
}
function aplicarTema() { document.documentElement.dataset.tema = cfg.tema; document.querySelector('meta[name=theme-color]').content = cfg.tema === 'escuro' ? '#0f1216' : '#0b4f9c'; }
function seg(el, opcoes, valor, onChange) {
  el.innerHTML = '';
  for (const [v, txt] of opcoes) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = txt;
    if (v === valor) b.classList.add('on');
    b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onChange(v); };
    el.appendChild(b);
  }
}
function renderConfig() {
  $('#cfgNome').value = cfg.nome; $('#cfgLote').value = cfg.lote; $('#cfgTela').checked = cfg.tela;
  seg($('#cfgFormato'), [['km', 'km + metros'], ['estaca', 'Estaca (20 m)']], cfg.formato, (v) => { cfg.formato = v; salvarConfig(); render(); });
  seg($('#cfgTema'), [['claro', 'Claro'], ['escuro', 'Escuro (noite)']], cfg.tema, (v) => { cfg.tema = v; aplicarTema(); salvarConfig(); });
}
async function salvarConfig() {
  if (!$('#tela-config').hidden || pilha.includes('config')) {
    cfg.nome = $('#cfgNome').value.trim(); cfg.lote = $('#cfgLote').value.trim(); cfg.tela = $('#cfgTela').checked;
  }
  await db.set('cfg', { ...cfg });
  manterTela();
}
$('#cfgTela').onchange = salvarConfig;
$('#cfgNome').onchange = salvarConfig;
$('#cfgLote').onchange = salvarConfig;
$('#btnLimparExp').onclick = async () => {
  const aps = (await db.allAps()).filter((a) => a.exportado);
  if (!aps.length) { toast('Não há apontamentos exportados para apagar.'); return; }
  if (!confirm(`Apagar ${aps.length} apontamento(s) já exportado(s) deste celular? As fotos também serão apagadas.`)) return;
  for (const a of aps) await db.delAp(a.id);
  atualizarContador(); toast('Apontamentos exportados apagados.');
};

// ---------------------------------------------------------------- tela ligada
async function manterTela() {
  try {
    if (cfg.tela && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      if (!st.wake) { st.wake = await navigator.wakeLock.request('screen'); st.wake.addEventListener('release', () => { st.wake = null; }); }
    } else if (!cfg.tela && st.wake) { await st.wake.release(); st.wake = null; }
  } catch { /* sem suporte */ }
}
document.addEventListener('visibilitychange', manterTela);

// ---------------------------------------------------------------- GPS
function iniciarGPS() {
  if (!('geolocation' in navigator)) { aviso('Este aparelho não oferece localização.', 'bad'); return; }
  st.watchId = navigator.geolocation.watchPosition(onFix, onGpsErro, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function pararGPS() { if (st.watchId != null) navigator.geolocation.clearWatch(st.watchId); st.watchId = null; }
function onGpsErro(e) {
  if (e.code === 1) {
    aviso('Permissão de localização negada. Libere a localização para este app nas configurações do celular (Android: Configurações › Apps › Chrome › Permissões › Localização; iPhone: Ajustes › Privacidade › Serviços de Localização › Safari) e abra o app de novo.', 'bad');
    setGps('bad', 'sem GPS');
  } else if (!st.fix) {
    setGps('bad', 'sem sinal');
  }
}
function setGps(cls, txt) { const g = $('#gps'); g.className = 'gps ' + cls; g.querySelector('span').textContent = txt; }

function onFix(p) {
  const c = p.coords;
  processar({ lon: c.longitude, lat: c.latitude, acc: c.accuracy || 99, speed: c.speed, heading: c.heading, t: p.timestamp || Date.now() });
}

function processar(fix) {
  st.fix = fix;
  setGps(fix.acc <= 15 ? 'ok' : fix.acc <= 40 ? 'mid' : 'bad', '±' + Math.round(fix.acc) + ' m');
  st.loc = localizar(fix);
  render();
}

// direção do movimento (vetor leste/norte unitário) ou null
function movimento(fix) {
  if (fix.heading != null && !isNaN(fix.heading) && fix.speed != null && fix.speed > 1.5) {
    const h = fix.heading * Math.PI / 180; return { x: Math.sin(h), y: Math.cos(h) };
  }
  const p = st.prevFix;
  if (p && fix.t - p.t < 30000) {
    const cosl = Math.cos(fix.lat * Math.PI / 180);
    const dx = (fix.lon - p.lon) * 111320 * cosl, dy = (fix.lat - p.lat) * 110574, d = Math.hypot(dx, dy);
    if (d > Math.max(12, fix.acc)) return { x: dx / d, y: dy / d };
    return null;
  }
  return null;
}

function localizar(fix) {
  const thr = Math.min(120, Math.max(35, fix.acc * 1.5 + 15));
  const cands = engine.query(fix.lon, fix.lat, 500);
  // atualiza ponto anterior para cálculo de rumo
  if (!st.prevFix || Math.hypot((fix.lon - st.prevFix.lon) * 100000, (fix.lat - st.prevFix.lat) * 110000) > 12 || fix.t - st.prevFix.t > 30000) {
    var mov = movimento(fix); st.prevFix = fix;
  } else { mov = (fix.heading != null && fix.speed > 1.5) ? movimento(fix) : null; }

  if (!cands.length) { st.lastLine = null; return { status: 'off' }; }
  let best = cands[0];
  if (st.lastLine != null) {
    const k = cands.find((c) => c.line === st.lastLine);
    if (k && k.dist <= thr && k.dist <= best.dist + 15) best = k;
  }
  const L = engine.lines[best.line];
  if (L.f === FLAG_MUN) {
    const alt = cands.find((c) => engine.lines[c.line].f !== FLAG_MUN && c.dist <= best.dist + 6);
    if (alt) best = alt;
  }
  const line = engine.lines[best.line];
  const mudouRod = st.lastLine == null || engine.lines[st.lastLine]?.r !== line.r;

  // sentido
  if (mov) {
    const dot = mov.x * best.dirx + mov.y * best.diry;
    if (Math.abs(dot) > 0.35) { st.crescente = dot > 0; st.sentidoManual = false; }
  } else if (mudouRod && !st.sentidoManual) {
    st.crescente = null;
  }
  const status = best.dist <= thr ? (line.f === FLAG_MUN ? 'mun' : 'on') : 'near';
  if (status !== 'near') st.lastLine = best.line;
  const tr = engine.trechoAt(line.r, best.km, st.crescente);
  return {
    status, r: line.r, rodovia: engine.label(line.r), km: best.km, dist: best.dist, flag: line.f,
    trecho: tr, crescente: st.crescente,
  };
}

// ---------------------------------------------------------------- render principal
// ajusta o tamanho do número do km para caber na largura da tela
let _kmLen = -1, _kmW = -1;
function ajustarKm() {
  const el = $('#km'), w = $('#painel').clientWidth - 24, len = el.textContent.length;
  if (len === _kmLen && w === _kmW) return;
  _kmLen = len; _kmW = w;
  const max = Math.min(120, window.innerHeight * 0.16);
  el.style.fontSize = max + 'px';
  const need = el.scrollWidth;
  if (need > w) el.style.fontSize = Math.max(28, Math.floor(max * w / need)) + 'px';
}
window.addEventListener('resize', () => { _kmLen = -1; ajustarKm(); });
function aviso(txt, cls = '') { const a = $('#aviso'); if (!txt) { a.hidden = true; return; } a.hidden = false; a.className = 'aviso ' + cls; a.textContent = txt; }

function pistaTxt(tr, cresc) {
  if (!tr || tr.s !== 'DUP') return '';
  return cresc === true ? 'Pista D' : cresc === false ? 'Pista E' : 'Pista dupla';
}
function sentidoTxt(c) { return c === true ? 'Crescente' : c === false ? 'Decrescente' : 'Sentido ?'; }

function render() {
  const L = st.loc, main = $('#painel');
  const kmEl = $('#km');
  kmEl.classList.toggle('estaca', cfg.formato === 'estaca');
  $('#btnEstacaTxt').textContent = cfg.formato === 'estaca' ? 'km' : 'Estaca';
  if (!L) return;
  main.classList.toggle('fraco', L.status === 'near' || L.status === 'off');
  if (L.status === 'off') {
    $('#rod').textContent = 'Fora da rodovia';
    kmEl.textContent = '– – –';
    $('#sentTxt').textContent = '';
    $('#pista').hidden = true;
    $('#trecho').textContent = ''; $('#depara').textContent = '';
    aviso('Nenhuma rodovia cadastrada da Regional Leste num raio de 500 m.', 'info2');
    return;
  }
  $('#rod').textContent = L.rodovia;
  kmEl.textContent = cfg.formato === 'estaca' ? fmtEstaca(L.km) : fmtKm(L.km);
  ajustarKm();
  $('#sentTxt').textContent = sentidoTxt(L.crescente);
  $('#sent').classList.toggle('manual', st.sentidoManual);
  const p = pistaTxt(L.trecho, L.crescente); $('#pista').hidden = !p; $('#pista').textContent = p;
  const tr = L.trecho;
  $('#trecho').textContent = tr ? [tr.c, tr.a && 'Área ' + tr.a, SIT[tr.s]].filter(Boolean).join(' · ') : '';
  $('#depara').textContent = tr ? `${tr.de} → ${tr.pa}` : '';
  if (L.status === 'near') aviso(`Você está a ${Math.round(L.dist)} m do eixo da ${L.rodovia}.`, 'info2');
  else if (L.status === 'mun') aviso('Trecho municipal – responsabilidade do município (fora da jurisdição DER). km aproximado.');
  else if (L.flag === FLAG_SRE) aviso('km aproximado: trecho sem estaqueamento, calculado pelo traçado do SRE.');
  else if (st.fix && st.fix.acc > 40) aviso(`Sinal de GPS fraco (±${Math.round(st.fix.acc)} m). O km pode variar.`);
  else if (L.crescente == null) aviso('Comece a andar para o app identificar o sentido, ou toque no sentido para escolher.', 'info2');
  else aviso('');
}

$('#sent').onclick = () => {
  if (!st.loc || st.loc.status === 'off') return;
  st.crescente = st.crescente === true ? false : true;
  st.sentidoManual = true;
  st.loc.crescente = st.crescente;
  st.loc.trecho = engine.trechoAt(st.loc.r, st.loc.km, st.crescente);
  render();
  toast('Sentido alterado manualmente: ' + sentidoTxt(st.crescente));
};
$('#btnEstaca').onclick = () => { cfg.formato = cfg.formato === 'estaca' ? 'km' : 'estaca'; db.set('cfg', { ...cfg }); render(); };

// ---------------------------------------------------------------- apontamentos
let edit = null; // { ap, fotos:[{id?, blob, thumb, novo}], removidas:[] }

function snapshot() {
  const f = st.fix, L = st.loc;
  if (!f) return null;
  const on = L && (L.status === 'on' || L.status === 'mun' || L.status === 'near');
  const tr = on ? L.trecho : null;
  return {
    criado: new Date().toISOString(),
    lat: f.lat, lon: f.lon, acc: f.acc,
    rodovia: on ? L.rodovia : '', km: on ? L.km : null,
    kmTxt: on ? fmtKm(L.km) : '', estaca: on ? fmtEstaca(L.km) : '',
    crescente: on ? L.crescente : null, sentidoTxt: on && L.crescente != null ? sentidoTxt(L.crescente) : '',
    pista: on ? pistaTxt(tr, L.crescente) : '',
    trecho: tr ? tr.c : '', area: tr ? tr.a : '', de: tr ? tr.de : '', para: tr ? tr.pa : '',
    dist: on ? L.dist : null,
    base: !on ? 'fora' : L.status === 'mun' ? 'municipal' : L.status === 'near' ? `a ${Math.round(L.dist)} m do eixo` : L.flag === FLAG_SRE ? 'SRE (aprox.)' : 'estaqueamento',
  };
}

function renderLocCard(ap) {
  const l1 = ap.rodovia ? `${ap.rodovia} · km ${ap.kmTxt}` : 'Fora das rodovias cadastradas';
  const l2 = [ap.sentidoTxt, ap.pista, ap.trecho && 'Trecho ' + ap.trecho, ap.area && 'Área ' + ap.area].filter(Boolean).join(' · ');
  const { data, hora } = dataHora(ap.criado);
  $('#novoLoc').innerHTML = `<div class="l1"></div><div class="l2"></div><div class="l2"></div>`;
  const d = $('#novoLoc').children;
  d[0].textContent = l1; d[1].textContent = l2 || '—';
  d[2].textContent = `${data} ${hora} · GPS ±${Math.round(ap.acc)} m · ${ap.lat.toFixed(5)}, ${ap.lon.toFixed(5)}`;
}

async function novoApontamento() {
  if (!st.fix) { toast('Aguardando o sinal de GPS…'); return; }
  if (!cfg.nome) {
    const n = prompt('Antes do primeiro apontamento, digite seu nome (vai nas fotos e na planilha):', '');
    if (n && n.trim()) { cfg.nome = n.trim(); await db.set('cfg', { ...cfg }); }
  }
  edit = { ap: { ...snapshot(), tipo: '', lado: '', grav: '', obs: '', fotos: [] }, fotos: [], removidas: [] };
  abrirForm();
}

function abrirForm() {
  const ap = edit.ap;
  $('#novoTitulo').textContent = ap.id ? ap.codigo : 'Novo apontamento';
  $('#btnExcluirAp').hidden = !ap.id;
  $('#btnAtualizarLoc').hidden = !!ap.id;
  renderLocCard(ap);
  const tipo = $('#selTipo'); tipo.innerHTML = '';
  for (const t of TIPOS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t; if (ap.tipo === t) b.classList.add('on');
    b.onclick = () => { ap.tipo = t; tipo.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
    tipo.appendChild(b);
  }
  seg($('#selLado'), LADOS.map((x) => [x, x]), ap.lado, (v) => { ap.lado = v; });
  seg($('#selGrav'), GRAVS.map((x) => [x, x]), ap.grav, (v) => { ap.grav = v; });
  $('#obs').value = ap.obs || '';
  renderFotos();
  abrir('novo');
  $('#tela-novo .tconteudo').scrollTop = 0;
}

function renderFotos() {
  const el = $('#fotosNovo'); el.innerHTML = '';
  edit.fotos.forEach((f, i) => {
    const d = document.createElement('div'); d.className = 'foto';
    if (f.proc) { d.classList.add('proc'); d.textContent = 'processando…'; }
    else {
      const img = document.createElement('img'); img.src = f.url || (f.url = URL.createObjectURL(f.thumb || f.blob)); d.appendChild(img);
      img.onclick = () => window.open(URL.createObjectURL(f.blob), '_blank');
      const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Remover foto');
      x.onclick = () => { if (f.id) edit.removidas.push(f.id); edit.fotos.splice(i, 1); renderFotos(); };
      d.appendChild(x);
    }
    el.appendChild(d);
  });
}

async function addFotos(files) {
  for (const file of files) {
    const slot = { proc: true }; edit.fotos.push(slot); renderFotos();
    try {
      const ap = { ...edit.ap, nome: cfg.nome, lote: cfg.lote };
      const r = await stampPhoto(file, ap);
      Object.assign(slot, { proc: false, blob: r.blob, thumb: r.thumb, w: r.w, h: r.h, novo: true });
    } catch (e) {
      edit.fotos.splice(edit.fotos.indexOf(slot), 1); toast('Não foi possível ler a foto.');
    }
    renderFotos();
  }
}
$('#inCam').onchange = (e) => { addFotos([...e.target.files]); e.target.value = ''; };
$('#inGal').onchange = (e) => { addFotos([...e.target.files]); e.target.value = ''; };
$('#btnAtualizarLoc').onclick = () => {
  const s = snapshot(); if (!s) return;
  Object.assign(edit.ap, s); renderLocCard(edit.ap); toast('Posição atualizada.');
};

$('#btnSalvarAp').onclick = async () => {
  const ap = edit.ap;
  if (!ap.tipo) { toast('Escolha o tipo do apontamento.'); return; }
  if (edit.fotos.some((f) => f.proc)) { toast('Aguarde as fotos terminarem de processar.'); return; }
  ap.obs = $('#obs').value.trim();
  ap.nome = ap.nome || cfg.nome; ap.lote = ap.lote ?? cfg.lote;
  if (!ap.id) {
    const seq = (await db.get('seq', 0)) + 1; await db.set('seq', seq);
    ap.seq = seq;
    const ini = (cfg.nome || 'XX').split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 3).toUpperCase();
    const { data } = dataHora(ap.criado);
    ap.codigo = `${ini}-${data.slice(6)}${data.slice(3, 5)}${data.slice(0, 2)}-${String(seq).padStart(3, '0')}`;
  }
  delete ap.fotos;
  ap.alterado = new Date().toISOString();
  if (ap.exportado) ap.exportado = null; // editado: precisa reexportar
  const id = await db.putAp(ap); ap.id = id;
  for (const fid of edit.removidas) await db.delFoto(fid);
  for (const f of edit.fotos) if (f.novo) await db.putFoto({ apId: id, blob: f.blob, thumb: f.thumb, w: f.w, h: f.h });
  edit = null;
  voltar();
  atualizarContador();
  if (pilha.includes('lista')) renderLista();
  toast('Apontamento salvo ✔');
};

$('#btnExcluirAp').onclick = async () => {
  if (!confirm('Excluir este apontamento e suas fotos?')) return;
  await db.delAp(edit.ap.id); edit = null; voltar(); atualizarContador(); renderLista(); toast('Apontamento excluído.');
};

async function editarAp(id) {
  const ap = await db.getAp(id);
  const fotos = await db.fotosOf(id);
  edit = { ap, fotos: fotos.map((f) => ({ id: f.id, blob: f.blob, thumb: f.thumb })), removidas: [] };
  abrirForm();
}

$('#btnAdd').onclick = novoApontamento;
$('#btnLista').onclick = () => abrir('lista');

async function atualizarContador() {
  const n = (await db.allAps()).filter((a) => !a.exportado).length;
  const c = $('#cnt'); c.hidden = !n; c.textContent = n;
}

async function renderLista() {
  const el = $('#lista');
  const aps = (await db.allAps()).sort((a, b) => b.criado.localeCompare(a.criado));
  if (!aps.length) { el.innerHTML = '<p class="vazio">Nenhum apontamento ainda.<br>Toque no <b>+</b> da tela principal para registrar.</p>'; return; }
  el.innerHTML = '';
  for (const ap of aps) {
    const fotos = await db.fotosOf(ap.id);
    const it = document.createElement('div'); it.className = 'item';
    const im = fotos[0] ? Object.assign(document.createElement('img'), { src: URL.createObjectURL(fotos[0].thumb || fotos[0].blob) })
      : Object.assign(document.createElement('div'), { className: 'semfoto', textContent: '📍' });
    const tx = document.createElement('div'); tx.style.flex = '1';
    const { data, hora } = dataHora(ap.criado);
    tx.innerHTML = '<div class="t1"></div><div class="t2"></div><div class="t3"></div>';
    tx.children[0].textContent = ap.tipo;
    if (ap.grav) tx.children[0].insertAdjacentHTML('beforeend', `<span class="tag ${ap.grav}">${ap.grav}</span>`);
    if (ap.exportado) tx.children[0].insertAdjacentHTML('beforeend', '<span class="tag exp">exportado</span>');
    tx.children[1].textContent = ap.rodovia ? `${ap.rodovia} km ${ap.kmTxt} · ${ap.sentidoTxt || ''} ${ap.lado ? '· ' + ap.lado : ''}` : 'Fora das rodovias';
    tx.children[2].textContent = `${ap.codigo} · ${data} ${hora} · ${fotos.length} foto(s)`;
    it.append(im, tx);
    it.onclick = () => editarAp(ap.id);
    el.appendChild(it);
  }
}

// ---------------------------------------------------------------- exportação
let filtro = 'novos';
async function selecionar() {
  const aps = (await db.allAps()).sort((a, b) => a.criado.localeCompare(b.criado));
  const hoje = new Date().toDateString();
  return aps.filter((a) => filtro === 'todos' || (filtro === 'novos' && !a.exportado) || (filtro === 'hoje' && new Date(a.criado).toDateString() === hoje));
}
async function renderExportar() {
  seg($('#selFiltro'), [['novos', 'Não exportados'], ['hoje', 'De hoje'], ['todos', 'Todos']], filtro, (v) => { filtro = v; renderExportar(); });
  const sel = await selecionar();
  let nf = 0; for (const a of sel) nf += (await db.fotosOf(a.id)).length;
  $('#expResumo').textContent = sel.length ? `${sel.length} apontamento(s) · ${nf} foto(s)` : 'Nenhum apontamento para exportar neste filtro.';
  $('#btnCompartilhar').disabled = $('#btnBaixar').disabled = !sel.length;
  $('#expStatus').textContent = '';
}
async function gerar() {
  const sel = await selecionar();
  const items = [];
  for (const ap of sel) items.push({ ap, fotos: await db.fotosOf(ap.id) });
  const agora = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}_${p(agora.getHours())}${p(agora.getMinutes())}`;
  const nome = (cfg.nome || 'usuario').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_');
  $('#expStatus').textContent = 'Gerando arquivo…';
  const blob = await buildPackage(items, { nome: cfg.nome, quando: agora.toLocaleString('pt-BR') });
  const file = new File([blob], `KMLeste_${nome}_${stamp}.zip`, { type: 'application/zip' });
  return { file, sel };
}
async function marcar(sel) {
  const q = new Date().toISOString();
  for (const a of sel) { a.exportado = q; await db.putAp(a); }
  atualizarContador();
}
$('#btnCompartilhar').onclick = async () => {
  try {
    const { file, sel } = await gerar();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'KM Leste – apontamentos', text: `${sel.length} apontamento(s) – KM Leste` });
      await marcar(sel); $('#expStatus').textContent = `Enviado: ${file.name}`; renderExportar();
    } else {
      baixar(file); await marcar(sel);
      $('#expStatus').textContent = 'Este navegador não permite enviar direto. O arquivo foi salvo; envie pelo WhatsApp como documento.';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') $('#expStatus').textContent = 'Envio cancelado.';
    else { console.error(e); $('#expStatus').textContent = 'Erro ao gerar o arquivo: ' + (e.message || e); }
  }
};
$('#btnBaixar').onclick = async () => {
  try { const { file, sel } = await gerar(); baixar(file); await marcar(sel); $('#expStatus').textContent = `Arquivo salvo: ${file.name}`; renderExportar(); }
  catch (e) { console.error(e); $('#expStatus').textContent = 'Erro ao gerar o arquivo: ' + (e.message || e); }
};
function baixar(file) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ---------------------------------------------------------------- sobre
function renderSobre() {
  const rods = {};
  for (const L of engine.lines) {
    const r = rods[L.r] ||= { est: 0, sre: 0, mun: 0 };
    const ext = Math.abs(L.km[L.n - 1] - L.km[0]) / 1000;
    if (L.f === FLAG_MUN) r.mun += ext; else if (L.f === FLAG_SRE) r.sre += ext; else r.est += ext;
  }
  let tot = 0;
  let rows = Object.keys(rods).sort().map((r) => { const x = rods[r]; tot += x.est + x.sre; return `<tr><td>${engine.label(r)}</td><td>${x.est.toFixed(1)}</td><td>${x.sre ? x.sre.toFixed(1) : ''}</td><td>${x.mun ? x.mun.toFixed(1) : ''}</td></tr>`; }).join('');
  $('#sobre').innerHTML = `<div class="sobre prose"><p><b>KM Leste</b> versão ${APP_VERSION} · base ${engine.version}</p>
  <p>Rodovias da Superintendência Regional Leste (SR1), Áreas 1 a 5. Base principal: estaqueamento a cada 20 m (KMZ da Regional Leste). Trechos sem estaqueamento e trechos municipais vêm do Sistema Rodoviário Estadual (geoserver DER/PR), com km aproximado.</p>
  <p>Extensão coberta: <b>${tot.toFixed(0)} km</b></p>
  <table><tr><th>Rodovia</th><th>Estaqueado (km)</th><th>SRE (km)</th><th>Municipal (km)</th></tr>${rows}</table></div>`;
}

// ---------------------------------------------------------------- simulação
$('#btnDemo').onclick = () => {
  if (!$('#menu').hidden) history.back();
  if (st.demo) { clearInterval(st.demo); st.demo = null; iniciarGPS(); toast('Simulação encerrada. Usando o GPS.'); return; }
  pararGPS();
  // percorre a PR-170 (Área 5) a ~72 km/h no sentido crescente
  const L = engine.lines.find((l) => l.r === '170' && l.f === 0);
  let i = 0, frac = 0;
  st.prevFix = null; st.lastLine = null; st.crescente = null;
  st.demo = setInterval(() => {
    frac += 0.5; while (frac >= 1) { frac -= 1; i++; }
    if (i >= L.n - 1) i = 0;
    const lon = L.lon[i] + (L.lon[i + 1] - L.lon[i]) * frac + (Math.random() - 0.5) * 4e-5;
    const lat = L.lat[i] + (L.lat[i + 1] - L.lat[i]) * frac + (Math.random() - 0.5) * 4e-5;
    processar({ lon, lat, acc: 4 + Math.random() * 3, speed: 20, heading: null, t: Date.now() });
  }, 500);
  toast('Simulação: percorrendo a PR-170. Toque de novo no menu para parar.');
};

// ---------------------------------------------------------------- início
async function init() {
  await carregarConfig();
  try {
    const r = await fetch('data/rodovias.json');
    engine = new Engine(await r.json());
  } catch (e) {
    $('#carregando').innerHTML = '<p style="padding:24px;text-align:center">Não foi possível carregar a base de rodovias. Abra o app com internet uma vez para baixar os dados.</p>';
    return;
  }
  $('#carregando').hidden = true;
  render();
  atualizarContador();
  iniciarGPS();
  manterTela();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Nova versão instalada. Feche e abra o app para atualizar.', 6000);
        });
      });
    }).catch(() => {});
  }
}
init();

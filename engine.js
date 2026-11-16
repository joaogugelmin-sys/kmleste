// Motor de localização: encontra rodovia, km e sentido a partir de lon/lat.
// Os dados vêm de data/rodovias.json (estacas do KMZ + complementos do SRE/DER).

const M_LAT = 110574;            // metros por grau de latitude
const M_LON = 111320;            // metros por grau de longitude no equador
const CELL = 0.01;               // célula da grade (~1 km)

export const FLAG_SRE = 1;       // trecho completado com traçado do SRE (precisão menor)
export const FLAG_MUN = 2;       // trecho municipal (fora da jurisdição DER)

export class Engine {
  constructor(data) {
    this.version = data.v;
    this.roadLabel = data.roads;
    this.lines = data.lines.map((l) => {
      const n = l.c.length / 3;
      const lon = new Float64Array(n), lat = new Float64Array(n), km = new Float64Array(n);
      let x = 0, y = 0, k = 0;
      for (let i = 0; i < n; i++) {
        x += l.c[3 * i]; y += l.c[3 * i + 1]; k += l.c[3 * i + 2];
        lon[i] = x / 1e6; lat[i] = y / 1e6; km[i] = k;
      }
      return { r: l.r, f: l.f, lon, lat, km, n };
    });
    // trechos SRE por rodovia
    this.trechos = {};
    for (const t of data.trechos) (this.trechos[t.r] ||= []).push(t);
    for (const r in this.trechos) this.trechos[r].sort((a, b) => a.k0 - b.k0);
    // grade espacial: célula -> lista de [linha, segmento]
    this.grid = new Map();
    this.lines.forEach((L, li) => {
      for (let i = 0; i < L.n - 1; i++) {
        const x0 = Math.floor(Math.min(L.lon[i], L.lon[i + 1]) / CELL), x1 = Math.floor(Math.max(L.lon[i], L.lon[i + 1]) / CELL);
        const y0 = Math.floor(Math.min(L.lat[i], L.lat[i + 1]) / CELL), y1 = Math.floor(Math.max(L.lat[i], L.lat[i + 1]) / CELL);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const key = gx * 100000 + gy;
          let a = this.grid.get(key); if (!a) this.grid.set(key, (a = []));
          a.push(li, i);
        }
      }
    });
  }

  label(r) { return this.roadLabel[r] || 'PR-' + r; }

  // Retorna candidatos (melhor projeção por linha) até `radius` metros, ordenados pela distância.
  query(lon, lat, radius = 300) {
    const cosl = Math.cos(lat * Math.PI / 180);
    const mx = M_LON * cosl, my = M_LAT;
    const dCells = Math.ceil((radius / my) / CELL);
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    const best = new Map(); // linha -> resultado
    const seen = new Set();
    for (let gx = cx - dCells; gx <= cx + dCells; gx++) for (let gy = cy - dCells; gy <= cy + dCells; gy++) {
      const a = this.grid.get(gx * 100000 + gy); if (!a) continue;
      for (let j = 0; j < a.length; j += 2) {
        const li = a[j], i = a[j + 1], sk = li * 1e6 + i;
        if (seen.has(sk)) continue; seen.add(sk);
        const L = this.lines[li];
        const ax = (L.lon[i] - lon) * mx, ay = (L.lat[i] - lat) * my;
        const bx = (L.lon[i + 1] - lon) * mx, by = (L.lat[i + 1] - lat) * my;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        let t = -(ax * dx + ay * dy) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
        if (d > radius) continue;
        const prev = best.get(li);
        if (!prev || d < prev.dist) {
          const len = Math.sqrt(len2);
          const dk = L.km[i + 1] - L.km[i];
          const sgn = dk >= 0 ? 1 : -1; // direção do km crescente
          best.set(li, {
            line: li, seg: i, t, dist: d,
            km: L.km[i] + t * dk,
            dirx: sgn * dx / len, diry: sgn * dy / len,
            // lado: >0 = ponto à esquerda do eixo (olhando no sentido crescente)
            side: sgn * (dx * (0 - ay) - dy * (0 - ax)) / len,
            atEnd: (t === 0 && i === 0) || (t === 1 && i === L.n - 2),
          });
        }
      }
    }
    return [...best.values()].sort((a, b) => a.dist - b.dist);
  }

  trechoAt(r, km, crescente) {
    const list = this.trechos[r]; if (!list) return null;
    const hits = list.filter((t) => km >= t.k0 - 30 && km <= t.k1 + 30);
    if (!hits.length) return null;
    if (hits.length === 1) return hits[0];
    // pista dupla (D/E): D = crescente, E = decrescente
    const want = crescente === false ? 'E' : 'D';
    const dup = hits.find((t) => t.c[3] === want);
    if (dup) return dup;
    // prefere o trecho em que o km está estritamente contido
    return hits.find((t) => km >= t.k0 && km <= t.k1) || hits[0];
  }
}

// ---- formatação ----
export function fmtKm(m) {
  const v = Math.max(0, Math.round(m));
  return Math.floor(v / 1000) + ' + ' + String(v % 1000).padStart(3, '0');
}
export function fmtEstaca(m) {
  const v = Math.max(0, Math.round(m)); // mesma precisão (1 m) do km exibido
  const e = Math.floor(v / 20);
  const r = v - e * 20;
  return 'Est. ' + e.toLocaleString('pt-BR') + ' + ' + r.toFixed(2).replace('.', ',');
}

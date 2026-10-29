/**
 * Ligação com o Painel Eleições 2026 (projeto 8.1): resultado do município e das zonas, buscado no arquivo
 * que o próprio painel publica, e links para abrir o município lá. Os dois apps usam o código de município do TSE.
 *
 * O painel publica data/tse_2026_presidente.json com acesso liberado entre sites (CORS do GitHub Pages).
 */
export const PAINEL_URL = 'https://celsoalmeidalf.github.io/eleicoes-2026/';

export class PainelGateway {
  constructor(base = PAINEL_URL, fetcher = (...a) => fetch(...a)) {
    this.base = base;
    this.fetch = fetcher;
    this._dados = null;
  }

  _carregar() {
    if (!this._dados) {
      this._dados = this.fetch(`${this.base}data/tse_2026_presidente.json`).then(async r => {
        if (!r.ok) throw new Error(`Painel indisponível (${r.status})`);
        const d = await r.json();
        const porChave = new Map(d.municipios.map(m => [`${m.uf}-${m.cd}`, m]));
        return { porChave, ufs: d.ufs, nacional: d.nacional };
      });
      this._dados.catch(() => { this._dados = null; });
    }
    return this._dados;
  }

  /**
   * Resultado do município (e da zona, se informada) nos dois turnos.
   * @returns {Promise<null | { nome: string, t1: object, t2: object, zona: { t1: object, t2: object } | null, link: string }>}
   */
  async resultado(uf, municipio, zona) {
    if (!uf || uf === 'ZZ' || !municipio) return null;
    const { porChave } = await this._carregar();
    const m = porChave.get(`${uf}-${+municipio}`);
    if (!m) return null;
    const z = zona ? m.zonas?.filter(x => x.zona === +zona) : null;
    return {
      nome: m.nome, t1: m.t1, t2: m.t2,
      zona: z?.length ? { numero: +zona, t1: z.find(x => x.turno === 1) || null, t2: z.find(x => x.turno === 2) || null } : null,
      link: this.linkMunicipio(uf, municipio)
    };
  }

  linkMunicipio(uf, municipio) {
    return `${this.base}#aba=municipios&uf=${encodeURIComponent(uf)}&municipio=${encodeURIComponent(`${uf}-${+municipio}`)}`;
  }

  linkUf(uf) {
    return `${this.base}#uf=${encodeURIComponent(uf)}`;
  }
}

/** % de Lula e de Flávio nos votos válidos (no 1º turno, os demais candidatos entram nos válidos) e comparecimento */
export function resumoTurno(t) {
  if (!t) return null;
  const validos = t.validos || (t.lula || 0) + (t.flavio || 0) + (t.outros || 0);
  return {
    lula: validos ? t.lula / validos * 100 : null,
    flavio: validos ? t.flavio / validos * 100 : null,
    comparecimento: t.aptos ? t.comparecimento / t.aptos * 100 : null,
    votos: t
  };
}

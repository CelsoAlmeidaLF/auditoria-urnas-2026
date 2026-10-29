/**
 * Locais de votação por UF (data/locais/<UF>.json, gerado por scripts/locais.mjs a partir do cadastro do TSE).
 * Cada arquivo traz uma linha por local; aqui viram objetos e um índice "município-zona-seção" → local.
 */
export class LocaisGateway {
  constructor(base = 'data/locais', fetcher = (...a) => fetch(...a)) {
    this.base = base;
    this.fetch = fetcher;
    this._ufs = new Map();
  }

  /** @returns {Promise<{ locais: object[], porSecao: Map<string, object> }>} */
  carregar(uf) {
    if (!this._ufs.has(uf)) {
      const pedido = this.fetch(`${this.base}/${uf}.json`).then(async r => {
        if (!r.ok) throw new Error(`Locais de ${uf} indisponíveis (${r.status})`);
        const d = await r.json();
        const locais = d.locais.map(linha => {
          const l = Object.fromEntries(d.colunas.map((c, i) => [c, linha[i]]));
          l.uf = uf;
          l.secoes = String(l.secoes).split(' ').filter(Boolean).map(Number);
          return l;
        });
        const porSecao = new Map();
        for (const l of locais) for (const s of l.secoes) porSecao.set(`${l.municipio}-${l.zona}-${s}`, l);
        return { locais, porSecao };
      });
      pedido.catch(() => this._ufs.delete(uf));
      this._ufs.set(uf, pedido);
    }
    return this._ufs.get(uf);
  }

  /** Local de votação de uma seção (zona e seção sem zeros à esquerda ou com) */
  async daSecao(uf, municipio, zona, secao) {
    const { porSecao } = await this.carregar(uf);
    return porSecao.get(`${municipio}-${+zona}-${+secao}`) || null;
  }
}

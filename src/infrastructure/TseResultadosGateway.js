/**
 * Arquivos de urna no site de resultados do TSE (resultados.tse.jus.br), que libera o acesso do navegador (CORS).
 * Só baixa quando a pessoa pede, direto do TSE para o aparelho: nada passa por outro servidor.
 *
 *   config/<uf>/<uf>-p00<pleito>-cs.json   municípios, zonas e seções da UF
 *   dados/<uf>/<mun>/<zona>/<secao>/p00<pleito>-<uf>-m<mun>-z<zona>-s<secao>-aux.json   arquivos publicados da seção
 *   dados/<uf>/<mun>/<zona>/<secao>/<hash>/<nome do arquivo>
 */

export const BASE_TSE = 'https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna';

/** Pleitos de 2026 no site de resultados */
export const PLEITOS = [
  { codigo: '3221', nome: '2º turno (25/10)' },
  { codigo: '3220', nome: '1º turno (04/10)' }
];

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export class TseResultadosGateway {
  constructor(fetcher = (...a) => fetch(...a), base = BASE_TSE) {
    this.fetch = fetcher;
    this.base = base;
    this._secoes = new Map();
  }

  async _json(url) {
    const r = await this.fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`O TSE respondeu ${r.status} para ${url}`);
    return r.json();
  }

  /**
   * Municípios, zonas e seções da UF.
   * @returns {Promise<{codigo: string, nome: string, zonas: {codigo: string, secoes: string[]}[]}[]>}
   */
  async municipios(pleito, uf) {
    const chave = `${pleito}-${uf}`;
    if (!this._secoes.has(chave)) {
      const u = uf.toLowerCase();
      const pedido = this._json(`${this.base}/${pleito}/config/${u}/${u}-p00${pleito}-cs.json`).then(cs => {
        const abr = (cs.abr || []).find(a => a.cd === u) || cs.abr?.[0];
        return (abr?.mu || []).map(m => ({
          codigo: m.cd,
          nome: m.nm,
          zonas: (m.zon || []).map(z => ({ codigo: z.cd, secoes: (z.sec || []).map(s => s.ns) }))
        })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      });
      pedido.catch(() => this._secoes.delete(chave));
      this._secoes.set(chave, pedido);
    }
    return this._secoes.get(chave);
  }

  _pasta({ uf, municipio, zona, secao }) {
    return `${this.base}/{pleito}/dados/${uf.toLowerCase()}/${municipio}/${zona}/${secao}`;
  }

  /**
   * Arquivos publicados de uma seção (pode haver mais de um conjunto, por exemplo depois de uma troca de urna).
   * @returns {Promise<{hash: string, data: string, hora: string, situacao: string, arquivos: {nome: string, tipo: string}[]}[]>}
   */
  async arquivosDaSecao(pleito, s) {
    const u = s.uf.toLowerCase();
    const pasta = this._pasta(s).replace('{pleito}', pleito);
    const aux = await this._json(`${pasta}/p00${pleito}-${u}-m${s.municipio}-z${s.zona}-s${s.secao}-aux.json`);
    return (aux.hashes || []).map(h => ({
      hash: h.hash, data: h.dr, hora: h.hr, situacao: h.st,
      arquivos: (h.arq || []).map(a => ({ nome: a.nm, tipo: a.tp }))
    }));
  }

  /** @returns {Promise<File>} */
  async baixar(pleito, s, hash, nome) {
    const url = `${this._pasta(s).replace('{pleito}', pleito)}/${hash}/${nome}`;
    const r = await this.fetch(url);
    if (!r.ok) throw new Error(`O TSE respondeu ${r.status} para ${nome}`);
    return new File([await r.arrayBuffer()], nome);
  }
}

/**
 * Leitor de ZIP sobre um Blob/File, sem bibliotecas: lê só o diretório central e, depois, só o arquivo pedido.
 * Assim o pacote de uma UF inteira (até ~2 GB) abre sem carregar tudo na memória.
 * Os .jez do TSE também são ZIP (deflate) e passam por aqui.
 * Descompressão pela DecompressionStream('deflate-raw') do próprio navegador (ou do Node 18+ nos testes).
 */

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_FIM64 = 0x06064b50;
const ASSINATURA_LOCALIZADOR64 = 0x07064b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

const LIMITE_DESCOMPRIMIDO = 256 * 1024 * 1024;

const lerFatia = async (blob, inicio, fim) => new DataView(await blob.slice(inicio, fim).arrayBuffer());

export class ZipLeitor {
  /** @param {Blob} blob */
  constructor(blob) {
    this.blob = blob;
    /** @type {{nome: string, metodo: number, comprimido: number, tamanho: number, deslocamento: number}[]} */
    this.entradas = [];
  }

  /** Começa por "PK\x03\x04"? (ZIP ou .jez) */
  static async ehZip(blob) {
    if (blob.size < 4) return false;
    return (await lerFatia(blob, 0, 4)).getUint32(0, true) === ASSINATURA_LOCAL;
  }

  async abrir() {
    const { blob } = this;
    // Fim do diretório central: nos últimos 22 bytes + comentário (até 64 KB)
    const tamCauda = Math.min(blob.size, 22 + 65535 + 20);
    const cauda = await lerFatia(blob, blob.size - tamCauda, blob.size);
    let pos = -1;
    for (let i = cauda.byteLength - 22; i >= 0; i--) {
      if (cauda.getUint32(i, true) === ASSINATURA_FIM) { pos = i; break; }
    }
    if (pos < 0) throw new Error('Arquivo não é um ZIP válido (fim do diretório não encontrado).');
    let total = cauda.getUint16(pos + 10, true);
    let tamCentral = cauda.getUint32(pos + 12, true);
    let inicioCentral = cauda.getUint32(pos + 16, true);

    // ZIP64 (pacotes acima de 4 GB ou com mais de 65 535 arquivos)
    if (pos >= 20 && cauda.getUint32(pos - 20, true) === ASSINATURA_LOCALIZADOR64) {
      const desl64 = Number(cauda.getBigUint64(pos - 20 + 8, true));
      const fim64 = await lerFatia(blob, desl64, desl64 + 56);
      if (fim64.getUint32(0, true) === ASSINATURA_FIM64) {
        total = Number(fim64.getBigUint64(32, true));
        tamCentral = Number(fim64.getBigUint64(40, true));
        inicioCentral = Number(fim64.getBigUint64(48, true));
      }
    }

    const central = await lerFatia(blob, inicioCentral, inicioCentral + tamCentral);
    const texto = new TextDecoder('utf-8');
    const entradas = [];
    let p = 0;
    for (let i = 0; i < total && p + 46 <= central.byteLength; i++) {
      if (central.getUint32(p, true) !== ASSINATURA_CENTRAL) throw new Error('Diretório do ZIP corrompido.');
      const metodo = central.getUint16(p + 10, true);
      let comprimido = central.getUint32(p + 20, true);
      let tamanho = central.getUint32(p + 24, true);
      const tamNome = central.getUint16(p + 28, true);
      const tamExtra = central.getUint16(p + 30, true);
      const tamComent = central.getUint16(p + 32, true);
      let deslocamento = central.getUint32(p + 42, true);
      const nome = texto.decode(new Uint8Array(central.buffer, central.byteOffset + p + 46, tamNome));
      // Campo extra ZIP64: tamanhos e deslocamento de 64 bits quando os de 32 estão em 0xFFFFFFFF
      let e = p + 46 + tamNome;
      const fimExtra = e + tamExtra;
      while (e + 4 <= fimExtra) {
        const id = central.getUint16(e, true);
        const tam = central.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (tamanho === 0xFFFFFFFF) { tamanho = Number(central.getBigUint64(q, true)); q += 8; }
          if (comprimido === 0xFFFFFFFF) { comprimido = Number(central.getBigUint64(q, true)); q += 8; }
          if (deslocamento === 0xFFFFFFFF) deslocamento = Number(central.getBigUint64(q, true));
        }
        e += 4 + tam;
      }
      entradas.push({ nome, metodo, comprimido, tamanho, deslocamento });
      p = fimExtra + tamComent;
    }
    this.entradas = entradas;
    return this;
  }

  /** @param {string} nome @returns {Promise<Uint8Array>} */
  async ler(nome) {
    const entrada = this.entradas.find(e => e.nome === nome);
    if (!entrada) throw new Error(`"${nome}" não está no arquivo.`);
    return this.lerEntrada(entrada);
  }

  async lerEntrada(entrada) {
    const cab = await lerFatia(this.blob, entrada.deslocamento, entrada.deslocamento + 30);
    if (cab.getUint32(0, true) !== ASSINATURA_LOCAL) throw new Error(`Cabeçalho local inválido em "${entrada.nome}".`);
    const inicio = entrada.deslocamento + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
    const dados = this.blob.slice(inicio, inicio + entrada.comprimido);
    if (entrada.metodo === 0) return new Uint8Array(await dados.arrayBuffer());
    if (entrada.metodo !== 8) throw new Error(`Compressão não suportada (${entrada.metodo}) em "${entrada.nome}".`);
    // Teto contra "bomba ZIP": no máximo o tamanho declarado (com folga) e nunca mais que 256 MB
    const teto = Math.min(LIMITE_DESCOMPRIMIDO, Math.max(entrada.tamanho * 2, 1 << 20));
    const leitor = dados.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.length;
      if (total > teto) {
        await leitor.cancel();
        throw new Error(`"${entrada.nome}" descomprime para mais do que o esperado; leitura interrompida.`);
      }
      partes.push(value);
    }
    const saida = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) { saida.set(p, pos); pos += p.length; }
    return saida;
  }
}

/** Texto dos arquivos do TSE (Latin-1 / Windows-1252) */
export const textoLatin1 = bytes => new TextDecoder('windows-1252').decode(bytes);

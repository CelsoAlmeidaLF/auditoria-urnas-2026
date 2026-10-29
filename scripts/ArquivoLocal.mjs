/**
 * Arquivo do disco com a mesma interface que o ZipLeitor usa de um Blob (size, slice → arrayBuffer/stream).
 * Existe porque o openAsBlob do Node 20 corta o tamanho de arquivos acima de 4 GB (conta módulo 2^32),
 * e os pacotes de CE, PA, PE, SC, BA, MG, RJ, RS, PR e SP passam disso. No navegador, o File não tem esse limite.
 */
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

class Fatia {
  constructor(fd, inicio, fim) { this.fd = fd; this.inicio = inicio; this.fim = fim; }
  get size() { return this.fim - this.inicio; }
  async arrayBuffer() {
    const buf = Buffer.allocUnsafe(this.size);
    let lido = 0;
    while (lido < buf.length) {
      const n = readSync(this.fd, buf, lido, buf.length - lido, this.inicio + lido);
      if (!n) break;
      lido += n;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + lido);
  }
  stream() {
    const fatia = this;
    return new ReadableStream({
      async start(controle) { controle.enqueue(new Uint8Array(await fatia.arrayBuffer())); controle.close(); }
    });
  }
  slice(a = 0, b = this.size) { return new Fatia(this.fd, this.inicio + a, this.inicio + Math.min(b, this.size)); }
}

export class ArquivoLocal {
  constructor(caminho) {
    this.fd = openSync(caminho, 'r');
    this.size = fstatSync(this.fd).size;
  }
  slice(inicio = 0, fim = this.size) { return new Fatia(this.fd, Math.max(0, inicio), Math.min(fim, this.size)); }
  fechar() { closeSync(this.fd); }
}

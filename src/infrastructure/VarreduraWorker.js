/**
 * Worker que resume todas as urnas de um pacote da UF sem travar a tela.
 * Recebe { arquivo: File }, devolve { tipo: 'progresso' | 'fim' | 'erro', ... }. Aceita { tipo: 'cancelar' }.
 */
import { ZipLeitor } from './ZipLeitor.js?v=20261029-1825';
import { identificarNome, resumirUrna } from '../application/AuditoriaService.js?v=20261029-1825';

let cancelado = false;

self.addEventListener('message', async ({ data }) => {
  if (data.tipo === 'cancelar') { cancelado = true; return; }
  cancelado = false;
  try {
    const zip = await new ZipLeitor(data.arquivo).abrir();
    const porUrna = new Map();
    for (const entrada of zip.entradas) {
      const i = identificarNome(entrada.nome);
      if (!i || !['log.jez', 'imgbu.dat', 'bu.dat'].includes(i.tipo)) continue;
      const u = porUrna.get(i.chave) || { info: i };
      u[i.tipo] = entrada;
      porUrna.set(i.chave, u);
    }
    const urnas = [...porUrna.values()].filter(u => u['log.jez']);
    let lote = [];
    for (let k = 0; k < urnas.length; k++) {
      if (cancelado) { self.postMessage({ tipo: 'fim', cancelado: true }); return; }
      const u = urnas[k];
      try {
        const log = await zip.lerEntrada(u['log.jez']);
        // Boletim digital (bu.dat) é menor e mais rápido de ler; o texto (imgbu) fica para quando não houver
        const bu = u['bu.dat'] ? await zip.lerEntrada(u['bu.dat']) : null;
        const imgbu = !bu && u['imgbu.dat'] ? await zip.lerEntrada(u['imgbu.dat']) : null;
        lote.push({ chave: u.info.chave, ...(await resumirUrna(log, imgbu, u.info.uf, bu, u.info)) });
      } catch (e) {
        lote.push({ chave: u.info.chave, erro: String(e.message || e) });
      }
      if (lote.length >= 25 || k === urnas.length - 1) {
        self.postMessage({ tipo: 'progresso', feitas: k + 1, total: urnas.length, resumos: lote });
        lote = [];
      }
    }
    self.postMessage({ tipo: 'fim', cancelado: false });
  } catch (e) {
    self.postMessage({ tipo: 'erro', mensagem: String(e.message || e) });
  }
});

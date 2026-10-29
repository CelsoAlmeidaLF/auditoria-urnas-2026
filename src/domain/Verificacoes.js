/**
 * Verificações de uma urna a partir do log do dia e, quando houver, do boletim e do log da urna substituída.
 * Cada verificação diz o que foi conferido, o resultado e se está "ok", pede "atencao" ou é só "info".
 * "atencao" não quer dizer fraude: quer dizer "abra o log nesse ponto e veja o que aconteceu".
 */
import { LIMITE_RAJADA_SEG, horaDeBrasilia } from './LogUrna.js?v=20261029-1825';
import { conferirComBoletim } from './Rdv.js?v=20261029-1825';

const br = n => (n ?? 0).toLocaleString('pt-BR');
const seg = s => (s == null ? '—' : s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/**
 * @param {ReturnType<import('./LogUrna.js?v=20261029-1825').analisarDia>} dia
 * @param {{ boletim?: ReturnType<import('./BoletimUrna.js?v=20261029-1825').lerBoletim>, original?: ReturnType<import('./LogUrna.js?v=20261029-1825').analisarDia> }} [extra]
 */
export function verificar(dia, { boletim = null, original = null, rdv = null } = {}) {
  const v = [];
  const add = (id, titulo, status, resultado, explicacao) => v.push({ id, titulo, status, resultado, explicacao });
  const votos = dia.votos.length;
  const votosOriginal = original ? original.votos.length : 0;
  // Na troca de urna, os votos do dia estão nas duas: soma as duas para as conferências de voto
  const semHabilitacao = dia.semHabilitacao + (original?.semHabilitacao ?? 0);
  const foraDaJanela = dia.foraDaJanela + (original?.foraDaJanela ?? 0);
  const iv = original && original.votos.length > votos ? original.intervalos : dia.intervalos;

  add('habilitacao', 'Todo voto teve um eleitor habilitado antes', semHabilitacao === 0 ? 'ok' : 'atencao',
    semHabilitacao === 0 ? `Sim: ${br(votos + votosOriginal)} votos, cada um depois de "Eleitor foi habilitado".` : `${br(semHabilitacao)} voto(s) computado(s) sem habilitação logo antes.`,
    'A urna só aceita um voto depois que o mesário libera o eleitor (biometria ou documento). Um voto sem habilitação antes seria o sinal de voto "fantasma".');

  add('janela', 'Nenhum voto fora do horário de votação', foraDaJanela === 0 ? 'ok' : 'atencao',
    foraDaJanela === 0 ? 'Todos os votos estão entre "Urna pronta para receber votos" e "Procedimento de encerramento confirmado".' : `${br(foraDaJanela)} voto(s) fora desse intervalo.`,
    'Voto antes da abertura ou depois do encerramento não deveria existir.');

  const abertura = original?.aberturas[0] ?? dia.aberturas[0];
  const uf = dia.uf;
  const hora = h => (uf && horaDeBrasilia(h, uf) !== h ? `${horaDeBrasilia(h, uf)} de Brasília (${h} no relógio da urna)` : uf ? `${h} de Brasília` : `${h} no relógio da urna`);
  if (abertura) {
    const deBrasilia = horaDeBrasilia(abertura.hora, uf);
    add('abertura', 'Abertura da votação', !uf ? 'info' : deBrasilia < '08:00:00' ? 'atencao' : 'ok',
      `${hora(abertura.hora)}${original?.aberturas[0] ? ', na urna anterior à troca' : ''}${dia.aberturas.length > 1 ? `; a votação foi retomada ${dia.aberturas.length - 1} vez(es), por exemplo depois de religar a urna` : ''}.`,
      uf ? 'A votação começa às 8h de Brasília em todo o país. Antes disso, só preparação: zerésima e registro de mesários.'
        : 'Sem o fuso da urna (seção no exterior ou arquivo sem o nome do TSE), o horário fica no relógio da urna. No Brasil a votação começa às 8h de Brasília; no exterior, às 8h do horário local.');
  } else {
    add('abertura', 'Abertura da votação', original ? 'info' : 'atencao', 'Não há "Urna pronta para receber votos" neste dia.',
      original ? 'Na troca de urna, a urna substituta pode só encerrar a votação e gerar o boletim.' : 'Confira se o dia escolhido é o da eleição.');
  }

  const enc = dia.encerramentos.at(-1) ?? original?.encerramentos.at(-1);
  const recuperado = dia.recuperacoes.at(-1) ?? original?.recuperacoes.at(-1);
  add('encerramento', 'Encerramento', enc || recuperado ? 'info' : 'atencao',
    enc ? `${hora(enc.hora)}.` : recuperado ? `Sem o comando de encerramento: a urna foi desligada e o boletim foi recuperado pelo aplicativo RED às ${hora(recuperado.hora)}.` : 'Não há "Procedimento de encerramento confirmado" neste dia.',
    'A votação termina às 17h de Brasília para quem não está na fila; a seção encerra depois do último eleitor da fila. Depois do encerramento a urna gera e imprime o boletim e grava os arquivos de resultado.');
  const tarde = dia.depoisDas17h + (original?.depoisDas17h ?? 0);
  if (uf && tarde) {
    add('depois17h', 'Votos depois das 17h de Brasília', 'info', `${br(tarde)} voto(s).`,
      'Eleitores que estavam na fila às 17h votam depois desse horário. Compare com o tamanho da fila e com a hora do encerramento.');
  }

  add('rajadas', `Intervalo entre votos (menos de ${LIMITE_RAJADA_SEG} s é incomum)`, iv.rajadas ? 'atencao' : iv.lista.length ? 'ok' : 'info',
    iv.lista.length ? `Menor: ${seg(iv.menor)}; mediano: ${seg(iv.mediana)}; ${br(iv.rajadas)} par(es) com menos de ${LIMITE_RAJADA_SEG} s.` : 'Menos de dois votos no dia.',
    'Entre dois votos o mesário identifica o eleitor, colhe a digital e o eleitor vota em cada cargo. Votos muito colados pedem um olhar no log daquele horário.');

  // Assinatura sem sucesso: a urna se recusa a iniciar. Conta se, depois da última falha, ela foi religada e
  // todas as verificações seguintes tiveram sucesso antes de abrir a votação.
  const falhas = dia.assinaturas.falhas;
  let depois = '';
  if (falhas.length) {
    const ultima = falhas.at(-1);
    const seguintes = dia.eventos.filter(e => e.seg > ultima.seg && e.msg.startsWith('Verificação de assinatura'));
    const abriu = dia.aberturas.find(e => e.seg > ultima.seg);
    if (seguintes.length && seguintes.every(e => e.msg.includes('[SUCESSO]')) && abriu) {
      depois = ` Depois disso a urna foi religada e as ${br(seguintes.length)} verificações seguintes tiveram sucesso antes de a votação abrir (${hora(abriu.hora)}). A urna se recusou a funcionar enquanto a assinatura estava inválida: é o mecanismo de proteção atuando. O log não diz a causa (pode ser falha de leitura do cartão).`;
    }
  }
  add('assinaturas', 'Assinatura digital dos programas', falhas.length ? 'atencao' : dia.assinaturas.ok ? 'ok' : 'info',
    falhas.length
      ? `${br(falhas.length)} verificação(ões) sem "[SUCESSO]": ${falhas.map(e => `${hora(e.hora)} ${e.msg.replace(/^Verificação de assinatura - /, '')}`).join('; ')}.${depois}`
      : dia.assinaturas.ok ? `${br(dia.assinaturas.ok)} verificações com "[SUCESSO]".` : 'O log deste dia não traz as verificações (elas aparecem quando a urna é ligada).',
    'Ao ligar, a urna confere a assinatura de cada pacote de software e dos arquivos dos cartões. Se alguma não confere, ela não inicia e pede nova carga.');

  const cargos = Object.entries(dia.confirmacoesPorCargo);
  if (cargos.length) {
    const diferentes = cargos.filter(([, n]) => n !== votos);
    add('cargos', 'Votos confirmados por cargo', diferentes.length ? 'info' : 'ok',
      cargos.map(([c, n]) => `${c}: ${br(n)}`).join(' · '),
      diferentes.length ? 'Um número diferente do total de votos pode ser o eleitor que desistiu no meio (o voto é concluído como nulo para os cargos que faltaram). Veja no log.' : 'Cada voto computado tem uma confirmação para cada cargo.');
  }

  if (dia.contingencia || original) {
    add('contingencia', 'Troca de urna (contingência)', 'info',
      original ? `Houve troca. Votos na urna anterior: ${br(votosOriginal)}; nesta: ${br(votos)}.` : 'Esta urna foi usada como substituta.',
      'Quando a urna falha, a Justiça Eleitoral troca por outra e passa o cartão de memória: os votos já dados seguem na contagem. O log da urna anterior vem dentro do .jez.');
  }

  if (boletim) {
    const total = votos + votosOriginal;
    const interrompidos = [...dia.interrompidos, ...(original?.interrompidos || [])];
    const confereComInterrompidos = total !== boletim.comparecimento && total + interrompidos.length === boletim.comparecimento;
    add('bu-comparecimento', 'Log × boletim: quantidade de votos', total === boletim.comparecimento ? 'ok' : confereComInterrompidos ? 'info' : 'atencao',
      `Log: ${br(total)} voto(s)${original ? ` (${br(votosOriginal)} na urna anterior + ${br(votos)} nesta)` : ''} · Boletim: ${br(boletim.comparecimento)} de comparecimento.` +
        (interrompidos.length ? ` ${br(interrompidos.length)} voto(s) confirmado(s) no instante em que a urna desligou (${interrompidos.map(e => hora(e.hora)).join(', ')}): o voto entrou no boletim, mas a linha "computado" não chegou ao log.` : '') +
        ((dia.contingencia || original) && total + interrompidos.length < boletim.comparecimento
          ? original
            ? ` Houve troca de urna e o log da urna que falhou veio incompleto no arquivo publicado (a última linha é das ${hora(original.eventos.at(-1)?.hora)}): ${br(boletim.comparecimento - total - interrompidos.length)} voto(s) estão no boletim, mas não aparecem no log.`
            : ` Houve troca de urna e o log da urna que falhou não veio no arquivo publicado: os ${br(boletim.comparecimento - total - interrompidos.length)} voto(s) dados antes da troca estão no boletim, mas não podem ser conferidos pelo log.`
          : ''),
      'Cada voto computado no log tem de aparecer no comparecimento do boletim impresso na seção. Se a urna desliga logo depois de o eleitor confirmar, o voto já está gravado e o log fica sem a última linha.');
    const bio = boletim.habilitacao?.['biométrica'];
    if (bio != null) {
      const bioLog = dia.biometricos + (original ? original.biometricos : 0);
      const bioInterrompidos = interrompidos.filter(e => e.biometrico).length;
      add('bu-biometria', 'Log × boletim: eleitores liberados pela digital', bioLog === bio ? 'ok' : bioLog + bioInterrompidos === bio ? 'info' : 'atencao',
        `Log: ${br(bioLog)} · Boletim: ${br(bio)}.`,
        'O boletim conta quantos eleitores foram liberados pela biometria; o log registra cada um.');
    }
    if (boletim.codigoUrna) {
      const urnas = [...dia.urnas, ...(original ? original.urnas : [])];
      add('bu-urna', 'Log × boletim: mesma urna', urnas.includes(boletim.codigoUrna) ? 'ok' : 'atencao',
        `Boletim: urna ${boletim.codigoUrna} · Log: ${urnas.join(', ') || '—'}.`,
        'O código da urna no boletim deve ser o mesmo que aparece em cada linha do log.');
    }
  }

  if (rdv && boletim) {
    const c = conferirComBoletim(rdv, boletim).filter(x => x.confere !== null);
    const diferentes = c.filter(x => !x.confere);
    add('rdv', 'Registro Digital do Voto × boletim', diferentes.length ? 'atencao' : 'ok',
      diferentes.length ? diferentes.map(x => `${x.cargo}: ${x.diferencas.slice(0, 3).join('; ')}`).join(' · ')
        : `Voto a voto, o RDV soma o mesmo que o boletim em ${c.length} cargo(s): ${c.map(x => x.cargo.toLowerCase()).join(', ')}.`,
      'O RDV guarda cada voto separado, embaralhado e sem ligação com o eleitor. Somando voto a voto, o resultado tem de ser igual ao do boletim.');
  }

  add('alertas', 'Alertas e erros registrados', 'info', `${br(dia.alertas.length)} alerta(s) e ${br(dia.erros.length)} erro(s) neste dia.`,
    'São avisos de operação (título digitado errado, impressora, mídia). A lista completa está na aba Eventos, filtrando por nível.');

  return v;
}

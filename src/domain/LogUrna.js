/**
 * Log da urna eletrônica (logd.dat): leitura e análise de um dia de votação.
 *
 * Cada linha do logd.dat tem 6 colunas separadas por tabulação:
 *   data e hora (horário local da urna) | nível (INFO, ALERTA, ERRO) | código da urna | aplicação | mensagem | código de verificação
 * O mesmo log guarda a preparação (carga, testes) e os turnos em que a urna foi usada, por isso a análise é por dia.
 * O log não registra em quem o eleitor votou: só que o voto foi confirmado para cada cargo e computado.
 */

const LINHA = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

export const LIMITE_RAJADA_SEG = 15;

/** Horas a somar ao relógio da urna para chegar ao horário de Brasília (a votação é das 8h às 17h de Brasília) */
export const FUSO_UF = { AC: 2, AM: 1, RO: 1, RR: 1, MT: 1, MS: 1 };

/**
 * Municípios no fuso do Acre (−5) dentro do Amazonas, pelo código do TSE: Itamarati, Tabatinga, Guajará,
 * Atalaia do Norte, Benjamin Constant, Eirunepé, Envira, Ipixuna, Jutaí, São Paulo de Olivença e Amaturá.
 * Conferido nos logs do 2º turno de 2026: 100% das urnas desses municípios abrem às 6h no relógio local.
 */
export const FUSO_MUNICIPIO = Object.fromEntries(['98370', '98477', '02020', '02054', '02135', '02291', '02313', '02399', '02496', '02755', '02917'].map(m => [`AM:${m}`, 2]));

/** Local da urna para o fuso: "RR" ou, quando o município muda o fuso, "AM:02020" */
export const localDaUrna = (uf, municipio) => (uf && municipio && FUSO_MUNICIPIO[`${uf}:${municipio}`] != null ? `${uf}:${municipio}` : uf);

/** "07:00:01" na urna de RR → "08:00:01" de Brasília. `uf` aceita também "UF:município" (localDaUrna) */
export function horaDeBrasilia(hora, uf) {
  const somar = (uf && (FUSO_MUNICIPIO[uf] ?? FUSO_UF[uf.slice(0, 2)])) || 0;
  if (!hora || !somar) return hora;
  return `${String((+hora.slice(0, 2) + somar) % 24).padStart(2, '0')}${hora.slice(2)}`;
}

/** Mensagens que marcam a história do dia (linha do tempo) */
export const MARCOS = [
  [/^Urna ligada em/, 'Urna ligada'],
  [/^Modo de carga da UE/, 'Modo de carga'],
  [/^Urna de contingência pronta/, 'Urna de contingência pronta'],
  [/^Contingência executada com sucesso/, 'Troca de urna (contingência)'],
  [/^Identificado arquivo de log corrompido/, 'Log da urna anterior com defeito'],
  [/^Inspeção da urna iniciada/, 'Inspeção da urna'],
  [/^Imprimindo relatório \[ZERÉSIMA\] via nº \[1\]/, 'Zerésima impressa (urna sem votos)'],
  [/^Operador encerrou ciclo de registro de mesários/, 'Registro de mesários concluído'],
  [/^Urna pronta para receber votos/, 'Início da votação'],
  [/^Título digitado para encerramento/, 'Pedido de encerramento'],
  [/^Procedimento de encerramento confirmado/, 'Votação encerrada'],
  [/^Gerando relatório \[BU\] \[INÍCIO\]/, 'Boletim de urna gerado'],
  [/^Imprimindo relatório \[BU\] via nº \[1\]/, 'Boletim impresso (1ª via)'],
  [/^Gerando arquivo de resultado \[bu\.dat\] \+ \[Início\]/, 'Arquivos de resultado gravados'],
  [/^Votação suspensa/, 'Votação suspensa (urna desligada)'],
  [/^Início da recuperação do BU final/, 'Boletim recuperado (aplicativo RED)'],
  [/^Desligando a urna/, 'Urna desligada']
];

/**
 * @param {string} texto Conteúdo do logd.dat (já decodificado de Latin-1)
 * @returns {{dia: string, hora: string, seg: number, nivel: string, urna: string, app: string, msg: string, verificador: string, n: number}[]}
 */
export function lerLog(texto) {
  const eventos = [];
  let n = 0;
  for (const linha of texto.split(/\r?\n/)) {
    n++;
    if (!linha) continue;
    const p = linha.split('\t');
    if (p.length < 5) continue;
    const m = LINHA.exec(p[0]);
    if (!m) continue;
    const [, d, mes, a, h, mi, s] = m;
    eventos.push({
      dia: `${d}/${mes}/${a}`,
      hora: `${h}:${mi}:${s}`,
      // segundos desde a época, sem fuso: o horário é o local da urna e só é comparado com ele mesmo
      seg: Date.UTC(+a, +mes - 1, +d, +h, +mi, +s) / 1000,
      nivel: p[1],
      urna: p[2],
      app: p[3],
      msg: p[4],
      verificador: p[5] || '',
      n
    });
  }
  return eventos;
}

/** Dias presentes no log, do mais antigo ao mais recente, com o que aconteceu em cada um */
export function diasDoLog(eventos) {
  const dias = new Map();
  for (const e of eventos) {
    let d = dias.get(e.dia);
    if (!d) dias.set(e.dia, d = { dia: e.dia, eventos: 0, votos: 0, votacao: false, turno: null, inicio: e.hora, fim: e.hora });
    d.eventos++;
    d.fim = e.hora;
    if (e.msg.startsWith('Urna pronta para receber votos')) d.votacao = true;
    if (e.msg.startsWith('O voto do eleitor foi computado')) d.votos++;
    const t = /(\d)º turno/.exec(e.msg);
    if (t && (e.msg.startsWith('Iniciando aplicação') || e.msg.startsWith('Turno da UE'))) d.turno = +t[1];
  }
  const ordenar = d => d.dia.split('/').reverse().join('');
  return [...dias.values()].sort((a, b) => ordenar(a).localeCompare(ordenar(b)));
}

/** Dia mais provável da eleição: o último com votação aberta ou com votos */
export function diaDaEleicao(dias) {
  const comVotacao = dias.filter(d => d.votacao || d.votos > 0);
  return (comVotacao.at(-1) || dias.at(-1))?.dia ?? null;
}

// Último valor do dia: na troca de urna, a substituta é carregada primeiro como "contingência" (seção 0000)
const valorDe = (eventos, prefixo) => {
  const e = eventos.findLast(x => x.msg.startsWith(prefixo));
  return e ? e.msg.slice(prefixo.length).trim() : null;
};

/**
 * Analisa um dia do log.
 * @param {ReturnType<typeof lerLog>} todos
 * @param {string} [dia] dd/mm/aaaa; padrão: o dia da eleição
 * @param {string} [uf] para converter o relógio da urna para o horário de Brasília
 */
export function analisarDia(todos, dia = diaDaEleicao(diasDoLog(todos)), uf = null) {
  const eventos = todos.filter(e => e.dia === dia);
  let votando = false;
  let habilitado = false;
  const votos = [];
  let semHabilitacao = 0;
  let foraDaJanela = 0;
  let habilitados = 0;
  let biometricos = 0;
  let tipoAtual = null;
  let habilitacaoBiometrica = false;
  const aberturas = [];
  const encerramentos = [];
  const confirmacoesPorCargo = {};
  let assinaturasOk = 0;
  const assinaturasFalha = [];
  let contingencia = false;
  let viasBu = 0;
  const recuperacoes = [];
  // Voto confirmado e a urna desligou antes de gravar "computado" (queda de energia): o boletim conta o voto
  const interrompidos = [];
  let confirmou = false;

  for (const e of eventos) {
    const msg = e.msg;
    if (msg.startsWith('Início das operações do logd')) {
      if (habilitado && confirmou) interrompidos.push({ ...confirmou, biometrico: habilitacaoBiometrica });
      habilitado = false;
      habilitacaoBiometrica = false;
      confirmou = false;
      continue;
    }
    if (msg.startsWith('Urna pronta para receber votos')) { votando = true; aberturas.push(e); }
    else if (msg.startsWith('Procedimento de encerramento confirmado')) { votando = false; encerramentos.push(e); }
    else if (msg.startsWith('Identificador do eleitor digitado pelo mesário')) {
      // Próximo eleitor: quem foi liberado e não votou não passa a liberação adiante
      habilitado = false;
      confirmou = false;
      tipoAtual = null;
      habilitacaoBiometrica = false;
    } else if (msg.startsWith('Tipo de habilitação do eleitor [')) {
      tipoAtual = msg.slice(32, msg.indexOf(']', 32));
      // Às vezes a linha do tipo sai logo depois de "Eleitor foi habilitado", no mesmo segundo
      if (habilitado) { habilitacaoBiometrica = tipoAtual === 'biométrica'; tipoAtual = null; }
    }
    else if (msg.startsWith('Eleitor foi habilitado')) {
      habilitados++;
      if (votando) habilitado = true;
      habilitacaoBiometrica = tipoAtual === 'biométrica';
      tipoAtual = null;
    } else if (msg.startsWith('O voto do eleitor foi computado')) {
      votos.push(e);
      if (!votando) foraDaJanela++;
      if (!habilitado) semHabilitacao++;
      // Como no boletim: conta a biometria só de quem chegou a votar
      if (habilitacaoBiometrica) biometricos++;
      habilitado = false;
      habilitacaoBiometrica = false;
      confirmou = false;
    } else if (msg.startsWith('Voto confirmado para [')) {
      if (habilitado) confirmou = e;
      const cargo = msg.slice(22, msg.indexOf(']', 22));
      confirmacoesPorCargo[cargo] = (confirmacoesPorCargo[cargo] || 0) + 1;
    } else if (msg.startsWith('Verificação de assinatura')) {
      if (msg.includes('[SUCESSO]')) assinaturasOk++;
      else assinaturasFalha.push(e);
    } else if (msg.startsWith('Contingência executada com sucesso') || msg === 'Modo de carga da UE - Urna de contingência') contingencia = true;
    else if (msg.startsWith('Imprimindo relatório [BU] via')) viasBu++;
    else if (msg.startsWith('Início da recuperação do BU final')) recuperacoes.push(e);
  }

  const intervalos = [];
  for (let i = 1; i < votos.length; i++) intervalos.push(votos[i].seg - votos[i - 1].seg);
  const ordenados = [...intervalos].sort((a, b) => a - b);
  const porHora = {};
  for (const v of votos) {
    const h = horaDeBrasilia(v.hora, uf).slice(0, 2);
    porHora[h] = (porHora[h] || 0) + 1;
  }

  const marcos = [];
  for (const e of eventos) {
    const marco = MARCOS.find(([re]) => re.test(e.msg));
    if (marco) marcos.push({ ...e, titulo: marco[1] });
  }

  return {
    dia,
    uf,
    eventos,
    urnas: [...new Set(eventos.map(e => e.urna).filter(Boolean))],
    identificacao: {
      municipio: valorDe(eventos, 'Município:'),
      zona: valorDe(eventos, 'Zona Eleitoral:'),
      secao: valorDe(eventos, 'Seção Eleitoral:'),
      versao: valorDe(eventos, 'Versão da aplicação:'),
      modelo: valorDe(eventos, 'Identificação do Modelo de Urna:'),
      modoCarga: valorDe(eventos, 'Modo de carga da UE -'),
      turno: diasDoLog(eventos)[0]?.turno ?? null
    },
    aberturas,
    encerramentos,
    votos,
    habilitados,
    biometricos,
    semHabilitacao,
    foraDaJanela,
    confirmacoesPorCargo,
    intervalos: {
      menor: ordenados[0] ?? null,
      mediana: ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null,
      maior: ordenados.at(-1) ?? null,
      rajadas: intervalos.filter(s => s < LIMITE_RAJADA_SEG).length,
      lista: intervalos
    },
    porHora,
    depoisDas17h: votos.filter(v => horaDeBrasilia(v.hora, uf) >= '17:00:00').length,
    alertas: eventos.filter(e => e.nivel === 'ALERTA'),
    erros: eventos.filter(e => e.nivel === 'ERRO'),
    assinaturas: { ok: assinaturasOk, falhas: assinaturasFalha },
    contingencia,
    viasBu,
    recuperacoes,
    interrompidos,
    marcos
  };
}

/**
 * Junta as análises de mais de um log do mesmo dia (urnas anteriores a uma ou mais trocas) numa só,
 * para somar votos e conferir com o boletim.
 */
export function juntarAnalises(analises) {
  if (analises.length === 1) return analises[0];
  const soma = campo => analises.reduce((s, a) => s + a[campo], 0);
  const lista = analises.flatMap(a => a.intervalos.lista);
  const ordenados = [...lista].sort((a, b) => a - b);
  const porHora = {};
  for (const a of analises) for (const [h, n] of Object.entries(a.porHora)) porHora[h] = (porHora[h] || 0) + n;
  const porHorario = (x, y) => x.seg - y.seg;
  return {
    ...analises[0],
    eventos: analises.flatMap(a => a.eventos).sort(porHorario),
    urnas: [...new Set(analises.flatMap(a => a.urnas))],
    aberturas: analises.flatMap(a => a.aberturas).sort(porHorario),
    encerramentos: analises.flatMap(a => a.encerramentos).sort(porHorario),
    votos: analises.flatMap(a => a.votos).sort(porHorario),
    habilitados: soma('habilitados'),
    biometricos: soma('biometricos'),
    semHabilitacao: soma('semHabilitacao'),
    foraDaJanela: soma('foraDaJanela'),
    depoisDas17h: soma('depoisDas17h'),
    intervalos: {
      menor: ordenados[0] ?? null,
      mediana: ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null,
      maior: ordenados.at(-1) ?? null,
      rajadas: lista.filter(x => x < LIMITE_RAJADA_SEG).length,
      lista
    },
    porHora,
    alertas: analises.flatMap(a => a.alertas),
    erros: analises.flatMap(a => a.erros),
    recuperacoes: analises.flatMap(a => a.recuperacoes),
    interrompidos: analises.flatMap(a => a.interrompidos),
    marcos: analises.flatMap(a => a.marcos).sort(porHorario)
  };
}

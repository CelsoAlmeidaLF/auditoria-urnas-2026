/**
 * Aba "Resumo da urna": identificação, números do dia, verificações, votos por hora, linha do tempo e boletim.
 */
import { icone } from './Icones.js?v=20261029-1755';
import { esc, br, duracao, nomeDaSecao } from './Formato.js?v=20261029-1755';
import { horaDeBrasilia } from '../domain/LogUrna.js?v=20261029-1755';
import { linkDoMapa } from '../domain/Endereco.js?v=20261029-1755';
import { somarRdv } from '../domain/Rdv.js?v=20261029-1755';
import { resumoTurno } from '../infrastructure/PainelGateway.js?v=20261029-1755';

const ICONE_STATUS = { ok: 'checkCircle', atencao: 'alert', info: 'info' };
const ROTULO_STATUS = { ok: 'Confere', atencao: 'Olhe no log', info: 'Informação' };
// Números já conhecidos no boletim digital, que traz só o número do candidato
const NOMES_PRESIDENTE = { 13: 'LULA', 22: 'FLAVIO BOLSONARO' };

export class UrnaView {
  /** @param {HTMLElement} raiz @param {{ aoTrocarDia: (dia: string) => void }} acoes */
  constructor(raiz, acoes) {
    this.raiz = raiz;
    this.acoes = acoes;
    raiz.addEventListener('change', e => {
      if (e.target.id === 'selDia') this.acoes.aoTrocarDia(e.target.value);
      if (e.target.id === 'votoCargo') this._desenharVoto();
    });
    raiz.addEventListener('input', e => {
      if (e.target.id === 'votoNumero' || e.target.id === 'votoHora') this._desenharVoto();
    });
  }

  /** @param {Awaited<ReturnType<import('../application/AuditoriaService.js?v=20261029-1755').AuditoriaService['analisar']>>} r */
  render(r) {
    this.r = r;
    const { urna, analise: a, analiseOriginal: o, boletim, verificacoes, dias } = r;
    const uf = a.uf;
    const hora = h => (h ? horaDeBrasilia(h, uf) : '—');
    const votos = a.votos.length + (o ? o.votos.length : 0);
    const abertura = (o?.aberturas[0] ?? a.aberturas[0])?.hora;
    const encerramento = a.encerramentos.at(-1)?.hora;
    const intervalo = o && o.votos.length > a.votos.length ? o.intervalos : a.intervalos;
    const atencao = verificacoes.filter(v => v.status === 'atencao').length;
    const fuso = uf && horaDeBrasilia('12:00:00', uf) !== '12:00:00';

    this.raiz.innerHTML = `
      <div class="urna-cabecalho">
        <div>
          <h2>${esc(nomeDaSecao(urna, boletim))}</h2>
          <p>Urna ${esc([...new Set([...(o?.urnas || []), ...a.urnas])].join(' → ') || '—')}${a.identificacao.modelo ? ` · modelo ${esc(a.identificacao.modelo)}` : ''}${a.identificacao.versao ? ` · software ${esc(a.identificacao.versao)}` : ''}</p>
          <p class="nota">Fonte: ${esc(urna.origem)}</p>
        </div>
        <label class="campo">Dia do log
          <select id="selDia">${dias.map(d => `<option value="${esc(d.dia)}" ${d.dia === a.dia ? 'selected' : ''}>${esc(d.dia)}${d.votos ? ` · ${br(d.votos)} votos` : d.votacao ? ' · votação' : ' · preparação'}${d.turno ? ` · ${d.turno}º turno` : ''}</option>`).join('')}</select>
        </label>
      </div>

      ${r.local ? cartaoLocal(r.local) : ''}
      ${r.painel ? cartaoPainel(r.painel) : ''}

      <div class="grade-kpi tres">
        ${kpi('Votos registrados no log', br(votos), o ? `${br(o.votos.length)} na urna anterior + ${br(a.votos.length)} nesta` : 'linhas "O voto do eleitor foi computado"')}
        ${kpi('Comparecimento no boletim', boletim ? br(boletim.comparecimento) : '—', boletim ? (boletim.fonte === 'bu.dat' ? 'boletim digital (bu.dat)' : 'boletim impresso (imgbu.dat)') : 'abra o bu.dat ou imgbu.dat')}
        ${kpi('Início da votação', esc(hora(abertura)), uf ? 'horário de Brasília' : 'relógio da urna')}
        ${kpi('Encerramento', esc(hora(encerramento)), uf ? 'horário de Brasília' : 'relógio da urna')}
        ${kpi('Menor intervalo entre votos', duracao(intervalo.menor), `mediano: ${duracao(intervalo.mediana)}`)}
        ${kpi('Pontos para olhar', String(atencao), atencao ? 'veja a lista abaixo' : 'todas as conferências bateram')}
      </div>

      <div class="glass-panel cartao">
        <h3 class="cartao-titulo">${icone('checkCircle')}Verificações</h3>
        <ul class="verificacoes">
          ${verificacoes.map(v => `
            <li class="verificacao" data-status="${v.status}">
              ${icone(ICONE_STATUS[v.status])}
              <strong>${esc(v.titulo)} <span class="selo selo-${v.status}">${ROTULO_STATUS[v.status]}</span></strong>
              <span class="resultado">${esc(v.resultado)}</span>
              <span class="explicacao">${esc(v.explicacao)}</span>
            </li>`).join('')}
        </ul>
      </div>

      <div class="grade-2">
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('clock')}Votos por hora${fuso ? ' (horário de Brasília)' : ''}</h3>
          ${barrasPorHora(o ? somarHoras(a.porHora, o.porHora) : a.porHora)}
          <div class="legenda"><span><i style="background:var(--br-green-text)"></i>até 17h</span><span><i style="background:var(--br-yellow-text)"></i>17h ou depois (eleitores que estavam na fila)</span></div>
        </div>
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('list')}Linha do tempo do dia</h3>
          ${linhaDoTempo(a, o, uf)}
        </div>
      </div>

      ${r.rdv ? cartaoVoto(r.rdv) : ''}

      ${boletim ? cartaoBoletim(boletim) : `
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('vote')}Boletim de urna</h3>
          <p class="nota">Sem boletim aberto. Para comparar o log com o resultado, abra também o <span class="font-mono">-bu.dat</span> ou o <span class="font-mono">-imgbu.dat</span> desta seção, ou busque a seção no site do TSE.</p>
        </div>`}
    `;
    this._desenharVoto();
  }

  /** "Confira o seu voto": procura o número no RDV do cargo e os votos perto do horário informado. Nada é guardado. */
  _desenharVoto() {
    const alvo = this.raiz.querySelector('#votoResultado');
    if (!alvo || !this.r?.rdv) return;
    const cargo = this.r.rdv.cargos.find(c => c.cargo === this.raiz.querySelector('#votoCargo').value) || this.r.rdv.cargos[0];
    const s = somarRdv(cargo);
    const numero = this.raiz.querySelector('#votoNumero').value.replace(/\D/g, '');
    const horaInformada = this.raiz.querySelector('#votoHora').value;
    const b = this.r.boletim?.cargos.find(c => c.cargo === cargo.cargo);
    let resposta = '<p class="nota">Digite o número em que você votou (ex.: 13, 22) para ver se há votos para ele nesta seção.</p>';
    if (numero) {
      const q = s.porNumero[numero] || 0;
      const qNulo = s.nulosDigitados[numero] || 0;
      resposta = q
        ? `<p class="voto-achado">${icone('checkCircle')}<span>Há <strong>${br(q)} voto(s)</strong> para o número <strong class="font-mono">${esc(numero)}</strong> em ${esc(cargo.cargo.toLowerCase())} nesta seção. Se você votou nele, o seu é um destes.</span></p>`
        : qNulo
          ? `<p class="voto-achado">${icone('info')}<span>O número <strong class="font-mono">${esc(numero)}</strong> não é de candidato: ${br(qNulo)} eleitor(es) digitaram esse número e o voto foi <strong>nulo</strong>.</span></p>`
          : `<p class="voto-ausente">${icone('alert')}<span><strong>Nenhum voto</strong> para o número <strong class="font-mono">${esc(numero)}</strong> em ${esc(cargo.cargo.toLowerCase())} nesta seção. Confira se escolheu o turno, a seção e o cargo certos. Se tudo estiver certo e você votou nesse número, guarde este registro: é exatamente o tipo de prova que importa numa auditoria.</span></p>`;
    }
    const linhas = Object.entries(s.porNumero).sort((x, y) => y[1] - x[1]).map(([n, q]) => {
      const nb = b?.candidatos.find(c => c.numero === n)?.votos;
      return `<tr class="${n === numero ? 'selecionada' : ''}"><td class="font-mono">${esc(n)}</td><td class="num">${br(q)}</td><td class="num">${nb == null ? '—' : br(nb)}</td><td>${nb == null ? '' : nb === q ? '<span class="selo selo-ok">igual</span>' : '<span class="selo selo-atencao">diferente</span>'}</td></tr>`;
    }).join('');
    const nulos = Object.entries(s.nulosDigitados).sort((x, y) => y[1] - x[1]);
    let perto = '';
    if (horaInformada) {
      const uf = this.r.analise.uf;
      const votos = [...(this.r.analiseOriginal?.votos || []), ...this.r.analise.votos];
      const alvoMin = +horaInformada.slice(0, 2) * 60 + +horaInformada.slice(3, 5);
      const proximos = votos.filter(v => { const h = horaDeBrasilia(v.hora, uf); return Math.abs(+h.slice(0, 2) * 60 + +h.slice(3, 5) - alvoMin) <= 10; });
      perto = `<p class="nota">Votos computados entre 10 minutos antes e depois das ${esc(horaInformada)} (horário de Brasília): <strong>${br(proximos.length)}</strong>${proximos.length ? ` — ${proximos.map(v => esc(horaDeBrasilia(v.hora, uf))).join(', ')}` : ''}. O log mostra que cada um desses eleitores foi liberado e teve o voto computado; não mostra em quem votou.</p>`;
    }
    alvo.innerHTML = `
      ${resposta}
      ${perto}
      <div class="grade-2">
        <div>
          <h4>Votos por número em ${esc(cargo.cargo.toLowerCase())} (RDV × boletim)</h4>
          <div class="tabela-wrap"><table class="tabela-urnas">
            <thead><tr><th>Número</th><th class="num">No RDV</th><th class="num">No boletim</th><th></th></tr></thead>
            <tbody>${linhas}
              <tr><td>Brancos</td><td class="num">${br(s.brancos)}</td><td class="num">${br(b?.brancos)}</td><td>${b && b.brancos === s.brancos ? '<span class="selo selo-ok">igual</span>' : ''}</td></tr>
              <tr><td>Nulos</td><td class="num">${br(s.nulos)}</td><td class="num">${br(b?.nulos)}</td><td>${b && b.nulos === s.nulos ? '<span class="selo selo-ok">igual</span>' : ''}</td></tr>
            </tbody></table></div>
        </div>
        <div>
          <h4>O que digitaram os eleitores que anularam</h4>
          ${nulos.length ? `<ul class="ocorrencias">${nulos.map(([d, q]) => `<li><span class="font-mono">${esc(d)}</span> <span class="nota">· ${br(q)} voto(s)</span></li>`).join('')}</ul>` : '<p class="nota">Nenhum voto nulo.</p>'}
          <details>
            <summary>Ver os ${br(cargo.votos.length)} votos, um por um, na ordem embaralhada do RDV</summary>
            <div class="votos-um-a-um">${cargo.votos.map(v => `<span class="voto voto-${v.tipo}" title="${esc(v.tipo)}">${esc(v.tipo === 'branco' ? 'B' : v.tipo === 'nulo' ? `N${v.digitado ? ` ${v.digitado}` : ''}` : v.digitado)}</span>`).join('')}</div>
          </details>
        </div>
      </div>`;
  }
}

function kpi(rotulo, valor, nota) {
  return `<div class="glass-panel kpi"><span class="kpi-rotulo">${esc(rotulo)}</span><span class="kpi-valor">${valor}</span><span class="kpi-nota">${esc(nota)}</span></div>`;
}

function somarHoras(a, b) {
  const t = { ...a };
  for (const [h, n] of Object.entries(b)) t[h] = (t[h] || 0) + n;
  return t;
}

function barrasPorHora(porHora) {
  const horas = Object.keys(porHora).sort();
  if (!horas.length) return '<p class="nota">Nenhum voto neste dia.</p>';
  const ini = +horas[0], fim = +horas.at(-1);
  const max = Math.max(...Object.values(porHora));
  let html = '<div class="barras" role="img" aria-label="Votos por hora">';
  for (let h = ini; h <= fim; h++) {
    const hh = String(h).padStart(2, '0');
    const n = porHora[hh] || 0;
    html += `<div class="barra"><div class="barra-coluna ${h >= 17 ? 'tarde' : ''}" style="height:${(n / max) * 100}%" data-valor="${n}" title="${hh}h: ${n} voto(s)"></div><span class="barra-rotulo">${hh}h</span></div>`;
  }
  return `${html}</div>`;
}

function linhaDoTempo(a, o, uf) {
  const marcos = [...(o ? o.marcos.map(m => ({ ...m, anterior: true })) : []), ...a.marcos].sort((x, y) => x.seg - y.seg);
  // Repetições seguidas do mesmo marco (ex.: inspeções) viram uma linha só
  const linhas = [];
  for (const m of marcos) {
    const ultimo = linhas.at(-1);
    if (ultimo && ultimo.titulo === m.titulo && ultimo.anterior === m.anterior) { ultimo.vezes++; continue; }
    linhas.push({ ...m, vezes: 1 });
  }
  if (!linhas.length) return '<p class="nota">Sem marcos neste dia.</p>';
  const destaque = /Início da votação|Votação encerrada|Boletim impresso/;
  const alerta = /contingência|Troca de urna|defeito/i;
  return `<ol class="linha-tempo">${linhas.map(m => `
    <li class="${destaque.test(m.titulo) ? 'destaque' : ''} ${alerta.test(m.titulo) ? 'alerta' : ''}">
      <span class="hora">${esc(horaDeBrasilia(m.hora, uf))}</span><span class="ponto"></span>
      <span>${esc(m.titulo)}${m.vezes > 1 ? ` <small>(${m.vezes} vezes)</small>` : ''}${m.anterior ? ' <small>· urna anterior</small>' : ''}</span>
    </li>`).join('')}</ol>`;
}

function cartaoBoletim(b) {
  const cargos = b.cargos.map(c => {
    const total = c.candidatos.reduce((s, x) => s + x.votos, 0) || 1;
    const candidatos = [...c.candidatos].sort((x, y) => y.votos - x.votos);
    return `<div class="boletim-cargo">
      <strong>${esc(c.cargo)}</strong>
      ${candidatos.map(x => {
        const nome = x.nome || (c.cargo === 'PRESIDENTE' && NOMES_PRESIDENTE[x.numero]) || '';
        return `<div class="boletim-linha"><span>${esc(nome)} <span class="font-mono">${esc(x.numero)}</span>${x.legenda ? ' <small>(legenda)</small>' : ''}</span><span class="num">${br(x.votos)}</span><div class="boletim-barra"><span style="width:${(x.votos / total) * 100}%"></span></div></div>`;
      }).join('')}
      <div class="boletim-totais"><span>Brancos: <b class="num">${br(c.brancos)}</b></span><span>Nulos: <b class="num">${br(c.nulos)}</b></span>${c.apurado != null ? `<span>Total apurado: <b class="num">${br(c.apurado)}</b></span>` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="glass-panel cartao">
    <h3 class="cartao-titulo">${icone('vote')}Boletim de urna</h3>
    <div class="boletim-totais">
      <span>Aptos: <b class="num">${br(b.aptos)}</b></span>
      <span>Comparecimento: <b class="num">${br(b.comparecimento)}</b></span>
      ${Object.entries(b.habilitacao || {}).map(([k, v]) => `<span>Liberados ${esc(k === 'biométrica' ? 'pela digital' : k === 'biográfica' ? 'por documento' : k)}: <b class="num">${br(v)}</b></span>`).join('')}
      ${b.abertura?.hora ? `<span>Abertura: <b class="num">${esc(b.abertura.hora)}</b></span>` : ''}
      ${b.fechamento?.hora ? `<span>Fechamento: <b class="num">${esc(b.fechamento.hora)}</b></span>` : ''}
    </div>
    ${cargos}
    <p class="nota">O log não diz em quem cada eleitor votou (o voto é secreto): ele registra que o voto foi confirmado e computado. Por isso a conferência entre log e boletim é de quantidade. Os horários do boletim são do relógio da urna.</p>
  </div>`;
}

function cartaoLocal(l) {
  return `<div class="glass-panel cartao">
    <div class="cabecalho-tabela">
      <h3 class="cartao-titulo">${icone('globe')}Local de votação: ${esc(l.nome)}</h3>
      <div class="acoes-linha">
        <a class="botao botao-secundario" href="${esc(linkDoMapa({ ...l, municipio: l.nomeMunicipio }))}" target="_blank" rel="noopener noreferrer">${icone('globe')}Mapa</a>
        <button type="button" class="botao botao-secundario" data-ver-zona="${esc(`${l.uf}|${l.municipio}|${l.zona}`)}">${icone('list')}Outras urnas da zona ${l.zona}</button>
      </div>
    </div>
    <dl class="endereco">
      <div><dt>Rua</dt><dd>${esc(l.rua || '—')}</dd></div>
      <div><dt>Número</dt><dd>${esc(l.numero || 'não informado')}</dd></div>
      <div><dt>Bairro</dt><dd>${esc(l.bairro || '—')}</dd></div>
      <div><dt>CEP</dt><dd class="font-mono">${esc(l.cep || '—')}</dd></div>
      ${l.complemento ? `<div class="largo"><dt>Complemento</dt><dd>${esc(l.complemento)}</dd></div>` : ''}
      <div class="largo"><dt>Seções neste local</dt><dd class="font-mono">${l.secoes.join(', ')} <span class="nota">· ${br(l.eleitores)} eleitores</span></dd></div>
    </dl>
    <p class="nota">Endereço no cadastro do TSE: ${esc(l.enderecoTse)}</p>
  </div>`;
}

function cartaoVoto(rdv) {
  return `<div class="glass-panel cartao" id="confiraVoto">
    <h3 class="cartao-titulo">${icone('search')}Confira o seu voto</h3>
    <p class="cartao-sub">O <strong>Registro Digital do Voto</strong> guarda cada voto desta urna, um por um, em ordem embaralhada e sem ligação com o eleitor. Nenhum arquivo diz qual voto é o seu (é o que garante o sigilo), mas dá para ver se existe voto para o número em que você votou e se a soma bate com o boletim. O que você digitar aqui não sai do seu aparelho.</p>
    <div class="campos campos-voto">
      <label class="campo">Cargo<select id="votoCargo">${rdv.cargos.map(c => `<option value="${esc(c.cargo)}">${esc(c.cargo.charAt(0) + c.cargo.slice(1).toLowerCase())}</option>`).join('')}</select></label>
      <label class="campo">Número em que você votou<input id="votoNumero" inputmode="numeric" autocomplete="off" placeholder="ex.: 13"></label>
      <label class="campo">Hora em que votou (opcional)<input id="votoHora" type="time"></label>
    </div>
    <div id="votoResultado"></div>
  </div>`;
}

/** Resultado do município e da zona no Painel Eleições 2026 (projeto 8.1), ao lado do log */
function cartaoPainel(p) {
  const pct = v => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  const linha = (rotulo, t) => {
    const r = resumoTurno(t);
    return r ? `<tr><td>${esc(rotulo)}</td><td class="num">${pct(r.lula)}</td><td class="num">${pct(r.flavio)}</td><td class="num">${pct(r.comparecimento)}</td><td class="num">${br(t.comparecimento)}</td></tr>` : '';
  };
  return `<div class="glass-panel cartao">
    <div class="cabecalho-tabela">
      <h3 class="cartao-titulo">${icone('chartBar')}Resultado no Painel Eleições 2026</h3>
      <a class="botao botao-secundario" href="${esc(p.link)}">${icone('globe')}Abrir ${esc(p.nome)} no painel</a>
    </div>
    <div class="tabela-wrap"><table class="tabela-urnas">
      <thead><tr><th></th><th class="num">Lula</th><th class="num">Flávio</th><th class="num">Comparecimento</th><th class="num">Votantes</th></tr></thead>
      <tbody>
        ${linha('Município · 1º turno', p.t1)}${linha('Município · 2º turno', p.t2)}
        ${p.zona ? `${linha(`Zona ${p.zona.numero} · 1º turno`, p.zona.t1)}${linha(`Zona ${p.zona.numero} · 2º turno`, p.zona.t2)}` : ''}
      </tbody></table></div>
    <p class="nota">Percentuais dos votos válidos. Dados do arquivo oficial do TSE processado pelo Painel Eleições 2026 (outro projeto Systekna), que mostra mapas, municípios e a demografia do voto.</p>
  </div>`;
}

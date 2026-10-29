/** Aba "Como ler o log": guia em linguagem simples, com os limites do que o log mostra. */
import { icone } from './Icones.js?v=20261029-1725';

export function renderComoLer(raiz) {
  raiz.innerHTML = `
  <div class="guia">
    <div class="intro">
      <h2>Como ler o log da urna</h2>
      <p>O log é o diário da urna: cada coisa que ela faz vira uma linha, com data e hora, desde a carga do programa (semanas antes) até a gravação do resultado. O TSE publica o log de todas as urnas depois da eleição. Você não precisa confiar neste app: dá para abrir o arquivo num editor de texto e conferir linha por linha.</p>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('list')}Uma linha do log</h3>
      <div class="exemplo-linha">25/10/2026 07:12:39	INFO	02282589	VOTA	O voto do eleitor foi computado	3C1F…</div>
      <dl>
        <dt>Data e hora</dt><dd>Relógio da urna, no horário local. Em AC, AM, RO, RR, MT e MS é preciso somar 1 ou 2 horas para chegar ao horário de Brasília; o app faz essa conta no resumo.</dd>
        <dt>Nível</dt><dd><code>INFO</code> é registro normal; <code>ALERTA</code> é aviso de operação (título digitado errado, eleitor parado na tela); <code>ERRO</code> é falha de equipamento ou mídia (impressora, cartão).</dd>
        <dt>Urna</dt><dd>Número de identificação da urna. É o mesmo que aparece no boletim ("Código identificação UE").</dd>
        <dt>Aplicação</dt><dd>Qual parte do programa escreveu a linha (lista abaixo).</dd>
        <dt>Mensagem</dt><dd>O que aconteceu.</dd>
        <dt>Verificador</dt><dd>Código que acompanha cada linha. Este app mostra o código no CSV, mas não confere.</dd>
      </dl>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('layers')}Aplicações que aparecem no log</h3>
      <dl>
        <dt>VOTA</dt><dd>A votação: zerésima, registro de mesários, identificação e liberação de cada eleitor, voto confirmado por cargo, voto computado, encerramento, boletim e gravação dos resultados.</dd>
        <dt>GAP</dt><dd>Inicia a urna: confere a assinatura digital de cada programa, lê os cartões de memória, mostra município, zona e seção carregados e o modo de carga (votação ou contingência).</dd>
        <dt>SCUE</dt><dd>Aparece nos dias de preparação (carga e testes), antes da eleição.</dd>
        <dt>LOGD</dt><dd>O próprio serviço de log: urna ligada, início e fim do arquivo, aviso de log corrompido.</dd>
        <dt>ATUE / INITJE</dt><dd>Teclas e chave de liga/desliga da urna.</dd>
      </dl>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('clock')}O dia da eleição no log</h3>
      <ol>
        <li><strong>Urna ligada</strong> e verificação das assinaturas dos programas.</li>
        <li><strong>Zerésima</strong>: relatório impresso que mostra que a urna está sem votos.</li>
        <li><strong>Registro dos mesários</strong>.</li>
        <li><strong>Urna pronta para receber votos</strong> às 8h de Brasília.</li>
        <li>Para cada eleitor: identificador digitado pelo mesário, digital (ou documento), <strong>Eleitor foi habilitado</strong>, voto confirmado para cada cargo e <strong>O voto do eleitor foi computado</strong>.</li>
        <li><strong>Procedimento de encerramento confirmado</strong> depois das 17h de Brasília, quando acaba a fila.</li>
        <li><strong>Boletim de urna</strong> gerado e impresso; arquivos de resultado gravados para envio ao TSE.</li>
      </ol>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('checkCircle')}O que o app confere</h3>
      <ul>
        <li>Se todo voto computado teve um eleitor habilitado antes (sem voto "fantasma").</li>
        <li>Se nenhum voto aconteceu antes da abertura ou depois do encerramento.</li>
        <li>O intervalo entre votos: menos de 15 segundos é incomum e pede um olhar.</li>
        <li>Se o número de votos no log é igual ao comparecimento do boletim, e se os eleitores liberados pela digital batem com o boletim.</li>
        <li>Se o número da urna no log é o mesmo do boletim.</li>
        <li>Se todas as verificações de assinatura dos programas tiveram sucesso.</li>
      </ul>
      <p>"Olhe no log" não quer dizer fraude: quer dizer que aquele ponto merece ser lido com calma na aba Eventos.</p>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('alert')}Troca de urna (contingência)</h3>
      <p>Quando uma urna falha durante a votação, a Justiça Eleitoral põe outra no lugar e passa para ela o cartão de memória com os votos já dados. O log da urna nova traz, dentro do <code>.jez</code>, o log da urna anterior. O app soma os dois para comparar com o boletim e marca os eventos da urna anterior na linha do tempo.</p>
      <p>Às vezes o <code>.jez</code> também traz logs antigos (de testes ou do 1º turno) que a urna guardou. Esses ficam de fora da soma, mas podem ser lidos na aba Eventos.</p>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('info')}O que o log não mostra</h3>
      <ul>
        <li><strong>Em quem cada eleitor votou.</strong> O voto é secreto: o log registra só que o voto foi confirmado e computado. Os votos de cada candidato estão no boletim e no Registro Digital do Voto (<code>-rdv.dat</code>), que embaralha a ordem dos votos.</li>
        <li><strong>Problemas antes da assinatura.</strong> O log é escrito pelo próprio programa da urna. Para conferir o programa, existem os testes públicos de segurança, a inspeção do código-fonte e o teste de integridade no dia da eleição.</li>
      </ul>
    </div>

    <div class="glass-panel cartao">
      <h3 class="cartao-titulo">${icone('search')}Confira sem este app</h3>
      <ol>
        <li>No <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noopener noreferrer">site de Resultados do TSE</a>, procure sua seção e baixe o arquivo de log (<code>-log.jez</code>).</li>
        <li>Renomeie para <code>.zip</code> e abra. Dentro está o <code>logd.dat</code>.</li>
        <li>Abra o <code>logd.dat</code> num editor de texto com codificação Latin-1 (ISO-8859-1).</li>
        <li>Procure "O voto do eleitor foi computado" no dia da eleição e conte as linhas: o total tem de bater com o comparecimento do boletim impresso na porta da seção.</li>
      </ol>
    </div>
  </div>`;
}

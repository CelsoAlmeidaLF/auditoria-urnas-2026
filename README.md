# Auditoria das Urnas (8.3)

App para abrir e conferir o **log** de qualquer urna eletrônica das eleições de 2026 e comparar com o **boletim de urna**. Roda no navegador, sem servidor nem dependências: os arquivos vêm direto do TSE para o aparelho e nada é enviado a outro lugar.

## O que faz

- **Abrir urna**: busca a seção no site de resultados do TSE (turno, UF, município, zona e seção, com a lista oficial de seções) ou abre arquivos do computador: `-log.jez`, `logd.dat`, `-bu.dat`, `-imgbu.dat` ou o pacote `.zip` de uma UF inteira. Dois exemplos reais vêm junto (Caroebe-RR e uma troca de urna em Chapada Gaúcha-MG).
- **Resumo da urna**: números do dia, verificações (voto sem eleitor habilitado, voto fora do horário, intervalo entre votos, assinaturas dos programas, votos por cargo, log × boletim em votos, biometria e número da urna), votos por hora em horário de Brasília, linha do tempo e o boletim.
- **Eventos do log**: todas as linhas, com busca, filtros (dia, aplicação, alertas, erros, só votos, marcos do dia), logs internos da urna anterior e CSV.
- **Urnas de uma UF**: confere todas as urnas de um pacote num Worker (a tela não trava) e lista primeiro as que pedem um olhar.
- **Como ler o log**: guia em linguagem simples, com o que o log mostra e o que não mostra.
- **Confira o seu voto**: lê o Registro Digital do Voto (`-rdv.dat`) da seção — cada voto em separado, embaralhado e sem ligação com o eleitor —, confere voto a voto com o boletim e mostra se há votos para o número digitado, o que digitaram os eleitores que anularam e os votos computados perto do horário informado. Nada é guardado nem enviado.
- **Locais e zonas**: endereço de cada local de votação (rua, número, complemento, bairro, CEP, mapa) e o que tinha no log de cada urna do local ou da zona inteira.
- **Relatórios** (botão Relatório no topo, conforme a aba): **PDF** pela impressão do navegador ("Salvar como PDF", A4) e **Excel (.xlsx)** gerado no aparelho, sem biblioteca — da urna (resumo, local, verificações, boletim, RDV voto a voto, linha do tempo, eventos do dia), da zona/local e do Panorama.
- **Ligação com o Painel Eleições 2026 (8.1)**: o resumo da urna e a aba Locais mostram o resultado do município e da zona buscado no arquivo que o painel publica (mesmo código de município do TSE), com link para abrir o município lá. No painel, a janela de cada município tem "Auditar os logs das urnas" e cada zona um link "ver urnas", que abrem este app em `#locais=UF/município/zona`.
- Link compartilhável de uma seção: `#secao=<pleito>/<UF>/<município>/<zona>/<seção>` (ex.: `#secao=3221/RR/03000/0004/0011`). Quem abre o link baixa a mesma seção do TSE.

## Arquivos do TSE

| Arquivo | O que é | Como o app lê |
|---|---|---|
| `-log.jez` | ZIP com o `logd.dat` (texto Latin-1, 6 colunas separadas por tabulação). Na troca de urna, traz dentro o `.jez` da urna anterior; às vezes traz também logs antigos guardados | `ZipLeitor` + `DecompressionStream`; logs internos só entram na soma se tiverem votação no mesmo dia |
| `-bu.dat` | Boletim digital assinado, ASN.1 (DER) | `BuDat.js`: urna, horários, comparecimento, liberados pela digital, votos por número |
| `-imgbu.dat` | Boletim em texto (o mesmo impresso na seção) | `BoletimUrna.js` |
| pacote `bu_imgbu_logjez_rdv_vscmr_2026_2t_UF.zip` | Todos os arquivos de uma UF ([Dados Abertos](https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao)) | lido aos pedaços (`Blob.slice`), sem carregar o pacote inteiro |

Site de resultados (com CORS liberado): `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/<pleito>/config/<uf>/<uf>-p00<pleito>-cs.json` (seções da UF) e `.../dados/<uf>/<mun>/<zona>/<secao>/p00<pleito>-<uf>-m<mun>-z<zona>-s<secao>-aux.json` (arquivos publicados de cada seção). Pleitos: `3220` (1º turno, 04/10) e `3221` (2º turno, 25/10).

## Regras da análise

- **Horário**: o log usa o relógio local da urna. Para AC (+2 h) e AM, RO, RR, MT, MS (+1 h) o app converte para Brasília; a votação vai das 8h às 17h de Brasília.
- **Voto**: cada linha "O voto do eleitor foi computado". Um voto precisa de "Eleitor foi habilitado" antes, sem um novo "Identificador do eleitor digitado pelo mesário" no meio.
- **Biometria**: conta só quem foi liberado pela digital e votou (é o que o boletim conta). A linha "Tipo de habilitação" pode vir antes ou logo depois de "Eleitor foi habilitado".
- **Troca de urna**: soma a urna anterior (log interno do mesmo dia) com a substituta.
- "Olhe no log" não quer dizer fraude: é um ponto para ler com calma na aba Eventos.

## Conferência feita em 29/10/2026 (2º turno)

| UF | Urnas | Votos no log | Comparecimento nos boletins | Pontos para olhar |
|---|---:|---:|---:|---:|
| RR | 1.519 | 308.597 | 308.597 | 0 |
| AL | 7.101 | 1.951.632 | 1.951.632 | 0 |

O leitor do `bu.dat` foi conferido com o `imgbu.dat` nas 1.519 urnas de RR: urna, comparecimento, biometria, horários e votos de Presidente iguais em todas.

## Arquitetura

```
src/domain/          LogUrna (leitura e análise do dia), BuDat, BoletimUrna, Verificacoes
src/application/     AuditoriaService (abrir arquivos e pacotes, buscar no TSE, analisar, resumir)
src/infrastructure/  ZipLeitor, TseResultadosGateway, VarreduraWorker
src/ui/              UrnaView, EventosView, PacoteView, ComoLerView, Icones, Formato
src/Program.js       composição, endereço #secao=, ações do topo
```

Design system comum: `vendor/stk-gov/` (cópia de `../_design-system/`, não editar aqui).

## Comandos

```bash
python3 -m http.server 8000                       # abrir em http://localhost:8000
npm test                                          # domínio com os exemplos reais (node --test)
npm run test:ui -- <pacote_UF.zip> [pasta]        # Chrome headless: exemplos, TSE, pacote inteiro, celular
node scripts/conferir_pacote.mjs <pacote_UF.zip> [saida.csv]   # mesma conferência pela linha de comando
npm run versionar                                 # carimba ?v= e atualiza o sw.js (rodar antes de publicar)
npm run design-system                             # confere a cópia do design system
```

Desenvolvido por Celso de Almeida Leite (Systekna) • Outubro de 2026

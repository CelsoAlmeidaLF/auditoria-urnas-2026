#!/usr/bin/env bash
# Baixa, confere e apaga o pacote de cada UF (PARALELO por vez, padrão 4), gravando data/panorama/<UF>.json.
# Retoma de onde parou: UF com .json pronto é pulada; download interrompido continua (curl -C -).
# Trava por UF (mkdir) impede dois processos na mesma UF; antes de baixar, espera ter espaço em disco.
#   PARALELO=4 bash scripts/panorama_brasil.sh [pasta_de_download] [UF ...]
set -u
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
DL="${1:-$AQUI/data/download}"; shift || true
UFS="${*:-RR AL ZZ AC AP RO TO SE MS DF MT AM RN PI ES PB GO SC MA PA PE CE PR RS BA RJ MG SP}"
PARALELO="${PARALELO:-4}"
FOLGA=$((5 * 1024 * 1024 * 1024))   # deixa 5 GB livres além do pacote
LOCAL="$AQUI/../8.1. ELEICOES/data/tse_raw/logs_2t"
BASE=https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/arqurnatot
mkdir -p "$DL"

uma_uf() {
  uf="$1"; nome="bu_imgbu_logjez_rdv_vscmr_2026_2t_$uf.zip"
  grep -qE '"versao":[23],' "$AQUI/data/panorama/$uf.json" 2>/dev/null && { echo "$uf: já conferida"; return 0; }
  mkdir "$DL/$uf.lock" 2>/dev/null || { echo "$uf: outro processo já está nela"; return 0; }
  trap 'rmdir "$DL/$uf.lock" 2>/dev/null' RETURN
  if [ -s "$LOCAL/$nome" ]; then zip="$LOCAL/$nome"; apagar=0
  else
    zip="$DL/$nome"; apagar=1
    esperado=$(curl -sI "$BASE/$nome" | grep -i '^content-length' | tr -dc 0-9)
    # Espera espaço: o que falta baixar deste pacote + folga
    while :; do
      ja=$(stat -c %s "$zip" 2>/dev/null || echo 0)
      livre=$(( $(df --output=avail -B1 "$DL" | tail -1) ))
      [ "$livre" -gt $(( esperado - ja + FOLGA )) ] && break
      echo "$uf: aguardando espaço em disco"; sleep 60
    done
    # Sem --retry no curl: com -C -, ele retomaria do ponto inicial e duplicaria pedaços.
    # Cada tentativa recalcula o ponto de retomada; arquivo maior que o original é apagado.
    for tentativa in $(seq 1 40); do
      ja=$(stat -c %s "$zip" 2>/dev/null || echo 0)
      [ "$ja" -gt "$esperado" ] && { echo "$uf: arquivo maior que o original, baixando de novo"; rm -f "$zip"; ja=0; }
      [ "$ja" = "$esperado" ] && break
      curl -s -f -C - -o "$zip" "$BASE/$nome"
      [ "$(stat -c %s "$zip" 2>/dev/null)" = "$esperado" ] && break
      echo "$uf: download interrompido em $(( $(stat -c %s "$zip" 2>/dev/null || echo 0) / 1048576 )) MB (tentativa $tentativa), retomando"; sleep 10
    done
    [ "$(stat -c %s "$zip")" = "$esperado" ] || { echo "$uf: FALHOU o download"; return 1; }
  fi
  node "$AQUI/scripts/panorama.mjs" "$uf" "$zip" && [ "$apagar" = 1 ] && rm -f "$zip"
}
export -f uma_uf; export AQUI DL LOCAL BASE FOLGA
printf '%s\n' $UFS | xargs -P "$PARALELO" -I{} bash -c 'uma_uf {}'
echo "FIM: $(ls "$AQUI"/data/panorama/*.json | wc -l) UFs conferidas"

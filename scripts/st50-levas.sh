#!/bin/bash
# ST-50: a memória do limitador de requisições por IP do Caddy volta a cair depois que as chaves vencem? (Hopper, INF-18)
#
#   scripts/st50-levas.sh [-w LEVAS] [-p PAUSA_s] [-m MEM_LIMIT] [-g GOMEMLIMIT] [-i IMAGEM]
#
# Sobe UM Caddy isolado (sem a stack) com a MESMA zona de produção (events 120, chave por cabeçalho) mas com janela e varredura de 10 s
# (produção: 60 s) para acelerar, manda LEVAS levas de 20 mil chaves NOVAS e anota, depois de cada leva e da pausa, a memória e o
# estado do container (OOMKilled, reinícios). Não prova nada sobre a janela de 60 s: mede o mecanismo de varredura/retenção.
# Uso só em DEV. Remove o container e a rede no fim (mesmo se interrompido).
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
W=20; PAUSA=25; MEM=768m; GOM=600MiB; IMG=meucardapio-caddy:smoke
while getopts "w:p:m:g:i:" o; do case $o in w) W=$OPTARG;; p) PAUSA=$OPTARG;; m) MEM=$OPTARG;; g) GOM=$OPTARG;; i) IMG=$OPTARG;; *) exit 2;; esac; done
CT=mc-st50-caddy; NET=mc-st50; T="$(mktemp -d)"; TW="$(cygpath -m "$T")"
cleanup() { docker rm -f "$CT" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT
printf '{\n\tadmin off\n}\n:8080 {\n\trate_limit {\n\t\tzone z {\n\t\t\tkey {http.request.header.X-Mem-Key}\n\t\t\tevents 120\n\t\t\twindow 10s\n\t\t}\n\t\tsweep_interval 10s\n\t}\n\trespond "ok"\n}\n' > "$T/Caddyfile"
docker network create "$NET" >/dev/null || exit 1
docker run -d --name "$CT" --network "$NET" --memory "$MEM" -e "GOMEMLIMIT=$GOM" -v "$TW/Caddyfile:/etc/caddy/Caddyfile:ro" "$IMG" caddy run --config /etc/caddy/Caddyfile >/dev/null || exit 1
sleep 4
mem() { docker stats --no-stream --format '{{.MemUsage}}' "$CT" 2>/dev/null | awk '{v=$1; if (v ~ /GiB/) {sub(/GiB/,"",v); printf "%.0f", v*1024} else {sub(/MiB/,"",v); printf "%.0f", v}}'; }
onda() { docker run --rm --network "$NET" node:20-alpine node -e "
  const http=require('http');const agent=new http.Agent({keepAlive:true,maxSockets:64});let sent=0,done=0,total=20000;
  const fin=()=>{done++; if(done===total){console.log('ok');agent.destroy();} else one();};
  const one=()=>{ if(sent>=total) return; const i=sent++; http.get({host:'$CT',port:8080,path:'/',agent,headers:{'X-Mem-Key':'$1-'+i}},r=>{r.resume();r.on('end',fin)}).on('error',fin); };
  for(let k=0;k<64;k++) one();" 2>&1 | tail -1; }
echo "# st50-levas: imagem=$IMG mem_limit=$MEM GOMEMLIMIT=$GOM levas=$W pausa=${PAUSA}s janela=10s varredura=10s events=120; início $(date '+%F %T')"
echo "# leva | logo após (MB) | ${PAUSA}s depois da varredura (MB) | estado do container"
m0="$(mem)"; echo "inicio: ${m0:-?} MB"
for w in $(seq 1 "$W"); do
  r="$(onda "w$w")"; a="$(mem)"; sleep "$PAUSA"; b="$(mem)"
  st="$(docker inspect -f 'running={{.State.Running}} oom={{.State.OOMKilled}} reinicios={{.RestartCount}}' "$CT" 2>/dev/null)"
  echo "leva $w | cliente=$r | ${a:-?} | ${b:-?} | $st"
  case "$st" in *running=false*) echo "# o container PAROU na leva $w; encerrando"; break;; esac
done
echo "# fim $(date '+%F %T')"

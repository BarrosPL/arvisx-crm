#!/usr/bin/env python3
"""Gera docker-compose.easypanel.yml a partir do UPSTREAM-docker-compose.yml (Supabase self-hosted).

Mudancas (todas mecanicas, para nao divergir do upstream):
- sem container_name e sem `ports` (Easypanel recusa; banco/pooler nunca ficam publicos);
- bind de dados vira volume nomeado (dados fora do checkout git);
- binds de configuracao apontam para ./api ./db ./pooler ./functions (layout deste repo);
- limite de memoria por servico (mem_limit), para um servico nao derrubar os agentes;
- api-gw tambem entra na rede externa `easypanel` (alias arvisx-supabase-gw) para o CRM alcancar;
- realtime ganha o alias de rede que o envoy espera (antes vinha do container_name).
Rodar: python3 gerar_compose.py   (usa PyYAML)
"""
import copy
import pathlib
import yaml

AQUI = pathlib.Path(__file__).parent
src = yaml.safe_load((AQUI / "UPSTREAM-docker-compose.yml").read_text())
out = copy.deepcopy(src)
out.pop("name", None)

MEM = {
    "db": "1536m", "studio": "768m", "realtime": "768m", "supavisor": "768m",
    "storage": "384m", "functions": "384m", "auth": "256m", "rest": "256m",
    "imgproxy": "256m", "meta": "256m", "api-gw": "256m",
}
VOL_NOMEADO = {
    "./volumes/db/data": "db-data",
    "./volumes/storage": "storage-data",
    "./volumes/snippets": "snippets-data",
}


def conv_volume(v):
    if not isinstance(v, str):
        return v
    partes = v.split(":")
    origem, resto = partes[0], partes[1:]
    # remove flags de SELinux (z / Z, em ":z" ou "ro,z"), mantem ro
    destino = resto[0]
    flags = [f for p in resto[1:] for f in p.split(",") if f and f not in ("z", "Z")]
    if origem in VOL_NOMEADO:
        flags = [f for f in flags if f != "ro"]
        return ":".join([VOL_NOMEADO[origem], destino] + ([",".join(flags)] if flags else []))
    if origem.startswith("./volumes/"):
        origem = "./" + origem[len("./volumes/"):]
    return ":".join([origem, destino] + ([",".join(flags)] if flags else []))


for nome, svc in out["services"].items():
    svc.pop("container_name", None)
    if "ports" in svc:
        internas = sorted({str(p).split(":")[-1].split("/")[0] for p in svc.pop("ports")})
        svc["expose"] = internas
    if "volumes" in svc:
        svc["volumes"] = [conv_volume(v) for v in svc["volumes"]]
    if nome in MEM:
        svc["mem_limit"] = MEM[nome]

# alias de rede que antes vinha do container_name (envoy/cds.yaml aponta para ele)
out["services"]["realtime"]["networks"] = {
    "default": {"aliases": ["realtime-dev.supabase-realtime"]}
}
gw = out["services"]["api-gw"]
gw["networks"] = {
    "default": {"aliases": ["envoy", "kong"]},
    "easypanel": {"aliases": ["arvisx-supabase-gw"]},
}

vols = out.get("volumes") or {}
for v in ("db-data", "storage-data", "snippets-data"):
    vols[v] = None
out["volumes"] = vols
out["networks"] = {"easypanel": {"external": True}}

cab = (
    "# GERADO por gerar_compose.py a partir de UPSTREAM-docker-compose.yml. Nao editar a mao.\n"
    "# Variaveis (${...}) vem do .env criado pelo Easypanel (Create .env file).\n"
)
(AQUI / "docker-compose.easypanel.yml").write_text(
    cab + yaml.safe_dump(out, sort_keys=False, width=1000, allow_unicode=True)
)
print("ok:", len(out["services"]), "servicos")

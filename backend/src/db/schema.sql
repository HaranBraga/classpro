CREATE TABLE IF NOT EXISTS ncm_classificacao (
  id          SERIAL PRIMARY KEY,
  ncm         VARCHAR(10) NOT NULL,
  descricao   TEXT,
  cclasstrib  VARCHAR(10) NOT NULL,
  desc_cclasstrib TEXT,
  cst         VARCHAR(10),
  desc_cst    TEXT,
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ncm ON ncm_classificacao(ncm);
CREATE INDEX IF NOT EXISTS idx_ncm_desc ON ncm_classificacao USING gin(to_tsvector('portuguese', COALESCE(descricao, '')));

CREATE TABLE IF NOT EXISTS cclasstrib_operacoes (
  id                          SERIAL PRIMARY KEY,
  cclasstrib                  VARCHAR(20) NOT NULL,
  cod_sit_tributaria          VARCHAR(20),
  desc_sit_tributaria         TEXT,
  exige_tributacao            TEXT,
  reducao_bc_cst              TEXT,
  reducao_aliquota            TEXT,
  transferencia_credito       TEXT,
  diferimento                 TEXT,
  monofasica                  TEXT,
  credito_presumido_ibs_zfm   TEXT,
  ajuste_competencia          TEXT,
  desc_cclasstrib             TEXT,
  perc_reducao_ibs            TEXT,
  perc_reducao_cbs            TEXT,
  trib_regular                TEXT,
  credito_presumido           TEXT,
  estorno_credito             TEXT,
  trib_monofasica_normal      TEXT,
  trib_monofasica_retencao    TEXT,
  trib_monofasica_retida      TEXT,
  trib_monofasica_combustivel TEXT,
  tipo_aliquota               TEXT,
  nfe     TEXT, nfce    TEXT, cte     TEXT, cte_os  TEXT,
  bpe     TEXT, nf3e    TEXT, nfcom   TEXT, nfse    TEXT,
  bpe_tm  TEXT, bpe_ta  TEXT, nfag    TEXT, nfsvia  TEXT,
  nfabi   TEXT, nfgas   TEXT, dere    TEXT,
  numero_anexo    TEXT,
  url_legislacao  TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cclasstrib_ops ON cclasstrib_operacoes(cclasstrib);

CREATE TABLE IF NOT EXISTS admin_users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(100) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

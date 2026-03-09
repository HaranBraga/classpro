const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// POST /api/admin/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    }

    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ token, username: user.username });
    } catch (err) {
        console.error('Erro no login:', err.message);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// GET /api/admin/stats — total de registros (protegido)
router.get('/stats', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM ncm_classificacao');
        res.json({ total: parseInt(result.rows[0].count) });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar stats' });
    }
});

// POST /api/admin/upload — upload de .xls/.xlsx e reimportação (protegido)
router.post('/upload', auth, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    const ext = req.file.originalname.toLowerCase();
    if (!ext.endsWith('.xls') && !ext.endsWith('.xlsx') && !ext.endsWith('.csv')) {
        return res.status(400).json({ error: 'Formato inválido. Use .xls, .xlsx ou .csv' });
    }

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Planilha vazia ou sem dados' });
        }

        // Detectar colunas automaticamente por ordem de prioridade do candidato
        const firstRow = rows[0];
        const keys = Object.keys(firstRow);
        const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\/\-_]/g, '');
        const keysNorm = keys.map(norm);
        const findCol = (...candidates) => {
            for (const c of candidates) {
                const cn = norm(c);
                const idx = keysNorm.findIndex(k => k === cn || k.includes(cn));
                if (idx !== -1) return keys[idx];
            }
            return null;
        };

        const colNcm = findCol('NCM / NBS', 'ncmnbs', 'NCM NBS', 'ncm', 'codigo', 'código');
        const colDesc = findCol('Descrição NCM / NBS', 'descricaoncm', 'Descrição Produto', 'descricaoproduto', 'descri', 'nome');
        const colCClass = findCol('cClassTrib', 'cclasstrib', 'classtrib', 'classificacao');
        const colDescCClass = findCol('Descrição cClassTrib', 'descricaocclasstrib', 'descclasstrib');
        const colCst = findCol('CST', 'cst');
        const colDescCst = findCol('Descrição CST', 'descricaocst', 'desc_cst', 'tributacao');

        if (!colNcm || !colCClass) {
            return res.status(400).json({
                error: 'Não foi possível detectar colunas NCM e cClassTrib na planilha',
                colunas_encontradas: keys,
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('TRUNCATE TABLE ncm_classificacao RESTART IDENTITY');

            // carry-forward: linhas com NCM vazio herdam o NCM da linha anterior
            let lastNcm = '';
            let lastDesc = null;
            const prepared = [];

            for (const row of rows) {
                let rawNcm = row[colNcm];
                let ncm;
                if (typeof rawNcm === 'number') {
                    ncm = rawNcm !== 0 ? String(Math.round(rawNcm)) : '';
                } else {
                    ncm = String(rawNcm || '').trim().replace(/[^0-9]/g, '');
                }

                if (ncm && ncm !== '0') {
                    lastNcm = ncm;
                    lastDesc = String(row[colDesc] || '').trim() || null;
                }

                if (!lastNcm) continue;

                const cclasstrib = String(row[colCClass] || '').trim();
                if (!cclasstrib) continue;

                const desc = String(row[colDesc] || '').trim() || lastDesc;
                let cst = null;
                if (row[colCst] !== undefined && row[colCst] !== '') {
                    cst = String(row[colCst]).trim() || null;
                }
                const descCst = String(row[colDescCst] || '').trim() || null;
                const descCClass = colDescCClass
                    ? String(row[colDescCClass] || '').replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim() || null
                    : null;
                prepared.push([lastNcm, desc, cclasstrib, descCClass, cst, descCst]);
            }

            const batchSize = 500;
            for (let i = 0; i < prepared.length; i += batchSize) {
                const batch = prepared.slice(i, i + batchSize);
                const values = [];
                const placeholders = batch.map((r) => {
                    const base = values.length;
                    values.push(...r);
                    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
                });
                await client.query(
                    `INSERT INTO ncm_classificacao (ncm, descricao, cclasstrib, desc_cclasstrib, cst, desc_cst) VALUES ${placeholders.join(',')}`,
                    values
                );
            }

            // ---- Importar 2ª aba: cClassTrib por Operações ----
            let ops2count = 0;
            const sheet2 = workbook.Sheets[workbook.SheetNames[1]];
            if (sheet2) {
                const rows2 = XLSX.utils.sheet_to_json(sheet2, { defval: '' });
                const n = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\/\-_.]/g, '');
                const keys2 = rows2[0] ? Object.keys(rows2[0]) : [];
                const k2 = keys2.map(n);
                const f2 = (...cs) => { for (const c of cs) { const i = k2.findIndex(k => k === n(c) || k.includes(n(c))); if (i !== -1) return keys2[i]; } return null; };

                const C = {
                    cclasstrib: f2('cClassTrib', 'cclasstrib'),
                    cod_sit: f2('Código da Situação Tributária', 'codsit'),
                    desc_sit: f2('Descrição da Situação Tributária', 'descsit'),
                    exige: f2('Exige Tributação', 'exigetrib'),
                    red_bc: f2('Redução BC CST', 'reducaobccst'),
                    red_aliq: f2('Redução de Alíquota', 'reducaodealiquota'),
                    transf_cred: f2('Transferência de Crédito', 'transferenciadecredito'),
                    diferimento: f2('Diferimento'),
                    monofasica: f2('Monofásica'),
                    cred_zfm: f2('Crédito Presumido IBS Zona Franca', 'creditopresumidoibszonafranc'),
                    ajuste: f2('Ajuste de Competência', 'ajustedecompetencia'),
                    desc_cc: f2('Descrição do Código da Classificação Tributária', 'descricaodoccodigo'),
                    perc_ibs: f2('Percentual Redução IBS', 'percentualreducaoibs'),
                    perc_cbs: f2('Percentual Redução CBS', 'percentualreducaocbs'),
                    trib_reg: f2('Tributação Regular', 'tributacaoregular'),
                    cred_pres: f2('Crédito Presumido', 'creditopresumido'),
                    estorno: f2('Estorno de Crédito', 'estornodecredito'),
                    mono_normal: f2('Tributação Monofásica Normal', 'tributacaomonofasicanormal'),
                    mono_ret: f2('Monofásica sujeita a retenção', 'monofasicasujeita'),
                    mono_retida: f2('Monofásica retida anteriormente', 'monofasicaretida'),
                    mono_comb: f2('Combustível com diferimento', 'combustivelcom'),
                    tipo_aliq: f2('Tipo de Alíquota', 'tipodealiquota'),
                    nfe: f2('NFe'), nfce: f2('NFCe'), cte: f2('CTe'), cte_os: f2('CTe OS'),
                    bpe: f2('BPe'), nf3e: f2('NF3e'), nfcom: f2('NFCom'), nfse: f2('NFSE'),
                    bpe_tm: f2('BPe TM'), bpe_ta: f2('BPe TA'), nfag: f2('NFAg'),
                    nfsvia: f2('NFSVIA'), nfabi: f2('NFABI'), nfgas: f2('NFGas'), dere: f2('DERE'),
                    numero_anexo: f2('Número do Anexo', 'numerodoanexo'),
                    url_leg: f2('Url da Legislação', 'urldaLegislacao', 'url'),
                };

                await client.query('TRUNCATE TABLE cclasstrib_operacoes RESTART IDENTITY');
                const g = (row, col) => col ? String(row[col] || '').replace(/\r\n|\r|\n/g, ' ').trim() || null : null;

                const prep2 = rows2
                    .filter(r => g(r, C.cclasstrib))
                    .map(r => [
                        g(r, C.cclasstrib), g(r, C.cod_sit), g(r, C.desc_sit), g(r, C.exige),
                        g(r, C.red_bc), g(r, C.red_aliq), g(r, C.transf_cred), g(r, C.diferimento),
                        g(r, C.monofasica), g(r, C.cred_zfm), g(r, C.ajuste), g(r, C.desc_cc),
                        g(r, C.perc_ibs), g(r, C.perc_cbs), g(r, C.trib_reg), g(r, C.cred_pres),
                        g(r, C.estorno), g(r, C.mono_normal), g(r, C.mono_ret), g(r, C.mono_retida),
                        g(r, C.mono_comb), g(r, C.tipo_aliq),
                        g(r, C.nfe), g(r, C.nfce), g(r, C.cte), g(r, C.cte_os),
                        g(r, C.bpe), g(r, C.nf3e), g(r, C.nfcom), g(r, C.nfse),
                        g(r, C.bpe_tm), g(r, C.bpe_ta), g(r, C.nfag), g(r, C.nfsvia),
                        g(r, C.nfabi), g(r, C.nfgas), g(r, C.dere),
                        g(r, C.numero_anexo), g(r, C.url_leg),
                    ]);

                for (let i = 0; i < prep2.length; i += batchSize) {
                    const batch = prep2.slice(i, i + batchSize);
                    const vals = [];
                    const ph = batch.map(row => {
                        const b = vals.length;
                        vals.push(...row);
                        return '(' + row.map((_, j) => `$${b + j + 1}`).join(',') + ')';
                    });
                    await client.query(
                        `INSERT INTO cclasstrib_operacoes (
                            cclasstrib,cod_sit_tributaria,desc_sit_tributaria,exige_tributacao,
                            reducao_bc_cst,reducao_aliquota,transferencia_credito,diferimento,
                            monofasica,credito_presumido_ibs_zfm,ajuste_competencia,desc_cclasstrib,
                            perc_reducao_ibs,perc_reducao_cbs,trib_regular,credito_presumido,
                            estorno_credito,trib_monofasica_normal,trib_monofasica_retencao,
                            trib_monofasica_retida,trib_monofasica_combustivel,tipo_aliquota,
                            nfe,nfce,cte,cte_os,bpe,nf3e,nfcom,nfse,bpe_tm,bpe_ta,nfag,nfsvia,
                            nfabi,nfgas,dere,numero_anexo,url_legislacao
                        ) VALUES ${ph.join(',')}`,
                        vals
                    );
                }
                ops2count = prep2.length;
            }

            await client.query('COMMIT');
            const count = await client.query('SELECT COUNT(*) FROM ncm_classificacao');
            res.json({
                success: true,
                total: parseInt(count.rows[0].count),
                message: `${count.rows[0].count} reg. NCM + ${ops2count} reg. cClassTrib importados`,
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Erro no upload:', err.message);
        res.status(500).json({ error: 'Erro ao processar planilha: ' + err.message });
    }
});

// DELETE /api/admin/clear — limpa todos os registros NCM e cClassTrib (protegido)
router.delete('/clear', auth, async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            await client.query('TRUNCATE TABLE ncm_classificacao RESTART IDENTITY');
            await client.query('TRUNCATE TABLE cclasstrib_operacoes RESTART IDENTITY');
            res.json({ success: true, message: 'Banco de dados limpo com sucesso.' });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Erro ao limpar banco:', err.message);
        res.status(500).json({ error: 'Erro ao limpar banco de dados: ' + err.message });
    }
});

module.exports = router;

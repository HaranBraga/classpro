require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rotas
app.use('/api/ncm', require('./routes/ncm'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pdf', require('./routes/pdf'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Error handler
app.use((err, req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

async function initDb() {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema aplicado');

    // Criar admin padrão se não existir
    const bcrypt = require('bcryptjs');
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const exists = await pool.query('SELECT id FROM admin_users WHERE username = $1', [username]);
    if (exists.rows.length === 0) {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO admin_users (username, password) VALUES ($1, $2)', [username, hash]);
        console.log(`✅ Admin criado: ${username}`);
    }

    // Seed automático: se tabela vazia, importar XLS do host
    const count = await pool.query('SELECT COUNT(*) FROM ncm_classificacao');
    if (parseInt(count.rows[0].count) === 0) {
        console.log('📊 Banco vazio — tentando seed automático do arquivo .xls...');
        await runSeed();
    } else {
        console.log(`📊 Banco com ${count.rows[0].count} registros NCM`);
    }
}

async function runSeed() {
    const XLSX = require('xlsx');
    // Mapeamento de possíveis caminhos para o arquivo XLS
    const candidates = [
        '/data/cClassTrib por NCMNBS vinculada.xls',
        '/data/cClassTrib por NCMNBS.xls',
        path.join(__dirname, '..', '..', 'cClassTrib por NCMNBS vinculada.xls'),
    ];

    let xlsPath = candidates.find(p => fs.existsSync(p));
    if (!xlsPath) {
        console.warn('⚠️  Arquivo .xls não encontrado para seed. Faça upload via admin.');
        return;
    }

    console.log(`📂 Lendo: ${xlsPath}`);
    const workbook = XLSX.readFile(xlsPath);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (rows.length === 0) {
        console.warn('⚠️  Planilha sem dados');
        return;
    }

    const keys = Object.keys(rows[0]);
    // Normaliza removendo espaços, barras, acentos para comparação
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\/\-_]/g, '');
    const keysNorm = keys.map(norm);
    // Itera candidatos em ORDEM DE PRIORIDADE e retorna a primeira key que bate
    const findCol = (...candidates) => {
        for (const c of candidates) {
            const cn = norm(c);
            const idx = keysNorm.findIndex(k => k === cn || k.includes(cn));
            if (idx !== -1) return keys[idx];
        }
        return null;
    };
    // Coluna NCM: 'NCM / NBS' tem prioridade sobre 'Código' (que está vazia)
    const colNcm = findCol('NCM / NBS', 'ncmnbs', 'NCM NBS', 'ncm', 'codigo', 'código');
    // Descrição: 'Descrição NCM / NBS' tem prioridade
    const colDesc = findCol('Descrição NCM / NBS', 'descricaoncm', 'Descrição Produto', 'descricaoproduto', 'descri', 'nome');
    const colCClass = findCol('cClassTrib', 'cclasstrib', 'classtrib', 'classificacao');
    const colDescCClass = findCol('Descrição cClassTrib', 'descricaocclasstrib', 'descclasstrib');
    const colCst = findCol('CST', 'cst');
    const colDescCst = findCol('Descrição CST', 'descricaocst', 'desc_cst', 'tributacao');

    if (!colNcm || !colCClass) {
        console.error('❌ Colunas NCM/cClassTrib não detectadas. Colunas:', keys);
        return;
    }

    console.log(`🔍 Colunas: NCM="${colNcm}" | Desc="${colDesc}" | cClassTrib="${colCClass}" | CST="${colCst}"`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const batchSize = 500;
        let inserted = 0;

        // carry-forward: NCMs com múltiplos cClassTrib omitem o NCM nas linhas extras
        let lastNcm = '';
        let lastDesc = null;

        // Processar TODAS as linhas em ordem antes de batchear (carry-forward precisa de sequência)
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
                // Nova linha com NCM preenchido — atualiza carry
                lastNcm = ncm;
                lastDesc = String(row[colDesc] || '').trim() || null;
            }
            // Se NCM vazio, usa o carry-forward (múltiplos cClassTrib do mesmo NCM)

            if (!lastNcm) continue; // ainda sem NCM válido

            const cclasstrib = String(row[colCClass] || '').trim();
            if (!cclasstrib) continue;

            // Descrição da linha atual (pode ser vazia nas linhas extras)
            const desc = String(row[colDesc] || '').trim() || lastDesc;

            // CST: pode ser 0 (válido) ou string
            let cst = null;
            if (row[colCst] !== undefined && row[colCst] !== '') {
                cst = String(row[colCst]).trim();
                if (cst === '') cst = null;
            }

            const descCst = String(row[colDescCst] || '').trim() || null;
            const descCClass = colDescCClass
                ? String(row[colDescCClass] || '').replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim() || null
                : null;

            prepared.push([lastNcm, desc, cclasstrib, descCClass, cst, descCst]);
        }

        // Inserir em batches
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
            inserted += batch.length;
        }

        await client.query('COMMIT');
        console.log(`✅ Seed concluído: ${inserted} registros`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro no seed:', err.message);
    } finally {
        client.release();
    }
}

app.listen(PORT, async () => {
    console.log(`🚀 ClassPro API rodando na porta ${PORT}`);
    try {
        await initDb();
    } catch (err) {
        console.error('❌ Erro ao inicializar banco:', err.message);
    }
});

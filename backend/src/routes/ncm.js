const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// GET /api/ncm/cclasstrib/:code — detalhes da 2ª aba para um cClassTrib (DEVE VIR ANTES de /search e /:code)
router.get('/cclasstrib/:code', async (req, res) => {
    const code = req.params.code.trim();
    try {
        const result = await pool.query(
            'SELECT * FROM cclasstrib_operacoes WHERE cclasstrib = $1 LIMIT 1',
            [code]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'cClassTrib não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao buscar cClassTrib:', err.message);
        res.status(500).json({ error: 'Erro interno ao buscar cClassTrib' });
    }
});

// GET /api/ncm/search — DEVE VIR ANTES de /:code
router.get('/search', async (req, res) => {
    const { q, limit = 20, offset = 0 } = req.query;
    if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Termo de busca deve ter ao menos 2 caracteres' });
    }
    try {
        const search = `%${q.trim()}%`;
        const result = await pool.query(
            `SELECT DISTINCT ON (ncm) ncm, descricao, cclasstrib, desc_cclasstrib, cst, desc_cst
             FROM ncm_classificacao
             WHERE descricao ILIKE $1 OR ncm ILIKE $1
             ORDER BY ncm
             LIMIT $2 OFFSET $3`,
            [search, Math.min(parseInt(limit), 100), parseInt(offset)]
        );
        const total = await pool.query(
            `SELECT COUNT(DISTINCT ncm) FROM ncm_classificacao WHERE descricao ILIKE $1 OR ncm ILIKE $1`,
            [search]
        );
        res.json({
            data: result.rows,
            total: parseInt(total.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('Erro na busca:', err.message);
        res.status(500).json({ error: 'Erro interno na busca' });
    }
});

// GET /api/ncm/:code — retorna TODOS os cClassTrib do NCM agrupados
router.get('/:code', async (req, res) => {
    const ncm = req.params.code.replace(/[^0-9]/g, '');
    if (ncm.length < 4 || ncm.length > 10) {
        return res.status(400).json({ error: 'NCM deve ter entre 4 e 10 dígitos' });
    }
    try {
        const result = await pool.query(
            `SELECT ncm, descricao, cclasstrib, desc_cclasstrib, cst, desc_cst
             FROM ncm_classificacao
             WHERE ncm = $1
             ORDER BY cclasstrib`,
            [ncm]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'NCM não encontrado' });
        }
        const first = result.rows[0];
        res.json({
            ncm: first.ncm,
            descricao: first.descricao,
            classificacoes: result.rows.map(r => ({
                cclasstrib: r.cclasstrib,
                desc_cclasstrib: r.desc_cclasstrib,
                cst: r.cst,
                desc_cst: r.desc_cst,
            })),
        });
    } catch (err) {
        console.error('Erro ao buscar NCM:', err.message);
        res.status(500).json({ error: 'Erro interno ao buscar NCM' });
    }
});

module.exports = router;

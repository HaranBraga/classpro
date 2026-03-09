const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { pool } = require('../db');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Apenas arquivos PDF são aceitos'));
    },
});

/**
 * Extrai NCMs do texto de um PDF brasileiro (NF-e, DANFE, relatórios fiscais).
 * Preserva a ORDEM de aparição e captura o nome do item da nota.
 *
 * Padrão real do DANFE observado:
 *   Linha N-2: "1144-790-1702Tubo do punho"   ← código dddd-ddd-dddd colado ao nome
 *   Linha N-1: "CEST:0801900"                  ← opcional
 *   Linha N  : "846791000006.102PEÇ4,00..."    ← NCM colado com CST/CFOP
 */
function extractNcms(text) {
    const found = new Map(); // ncm -> nome_item, preserva ordem de inserção

    const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    const lines = clean.split('\n');

    /**
     * Extrai o nome do item a partir da linha em que o NCM foi encontrado.
     * Procura nas linhas anteriores pelo padrão do código de produto DANFE.
     */
    function extractItemName(lineIndex) {
        for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 8); i--) {
            const l = lines[i].trim();
            if (!l) continue;

            // Ignora linhas de campos auxiliares
            if (/^CEST:/i.test(l)) continue;
            if (/^N\s+FCI\s/i.test(l)) continue;
            if (/^(NCM|CFOP|CST|PIS|COFINS|IPI|ICMS|UNID|QTD)/i.test(l)) continue;

            // Padrão principal DANFE: dddd-ddd-ddddNome
            // Ex: "1144-790-1702Tubo do punho"
            const danfeMatch = l.match(/^\d{4}-\d{3}-\d{4}(.+)/);
            if (danfeMatch) {
                const nome = danfeMatch[1].trim();
                if (nome.length >= 2) return nome.substring(0, 100);
            }

            // Padrão alternativo: código numérico longo + espaço + texto
            // Ex: "1144790 1702 Tubo do punho"
            const altMatch = l.match(/^\d{7,13}\s+([A-Za-zÀ-ú].{2,})/);
            if (altMatch) {
                return altMatch[1].trim().substring(0, 100);
            }

            // Linha que começa com letra (nome puro sem código)
            if (/^[A-Za-zÀ-ú]/.test(l) && l.length >= 3) {
                return l.substring(0, 100);
            }
        }
        return null;
    }

    let m;

    // Estratégia 1: Rótulo explícito "NCM/SH: XXXX.XX.XX"
    const labeled = /NCM\s*[/\-]?\s*(?:SH)?\s*[:\s]+([0-9]{4}\s*\.?\s*[0-9]{2}\s*\.?\s*[0-9]{0,2})/gi;
    while ((m = labeled.exec(clean)) !== null) {
        const digits = m[1].replace(/[^0-9]/g, '');
        if (digits.length >= 4 && digits.length <= 8) {
            const ncm = digits.padEnd(8, '0');
            if (!found.has(ncm)) {
                const lineIdx = clean.substring(0, m.index).split('\n').length - 1;
                found.set(ncm, extractItemName(lineIdx));
            }
        }
    }

    // Estratégia 2: Formato pontilhado XXXX.XX.XX
    const dotted = /\b(\d{4})\.(\d{2})\.(\d{2})\b/g;
    while ((m = dotted.exec(clean)) !== null) {
        const digits = m[1] + m[2] + m[3];
        const firstTwo = parseInt(m[1].substring(0, 2));
        if (firstTwo <= 97) {
            if (!found.has(digits)) {
                const lineIdx = clean.substring(0, m.index).split('\n').length - 1;
                found.set(digits, extractItemName(lineIdx));
            }
        }
    }

    // Estratégia 3: 8 dígitos consecutivos (capítulo SH 01-97)
    const eightDigit = /(?<![R$%/\d])(?<!\d)(\d{8})(?!\d)/g;
    while ((m = eightDigit.exec(clean)) !== null) {
        const digits = m[1];
        const ch = parseInt(digits.substring(0, 2), 10);
        if (ch >= 1 && ch <= 97) {
            if (!found.has(digits)) {
                const lineIdx = clean.substring(0, m.index).split('\n').length - 1;
                found.set(digits, extractItemName(lineIdx));
            }
        }
    }

    // Estratégia 4: NCM colado com CST e CFOP — padrão DANFE
    // Ex: "846791000006.102PEÇ..." → NCM=84679100
    const gluedDanfe = /(?<!\d)(\d{8})\d{3,4}[1-7]\.\d{3}/g;
    while ((m = gluedDanfe.exec(clean)) !== null) {
        const digits = m[1];
        const ch = parseInt(digits.substring(0, 2), 10);
        if (ch >= 1 && ch <= 97) {
            if (!found.has(digits)) {
                const lineIdx = clean.substring(0, m.index).split('\n').length - 1;
                found.set(digits, extractItemName(lineIdx));
            }
        }
    }

    return [...found.entries()]
        .filter(([ncm]) => ncm.length === 8)
        .map(([ncm, nome_item]) => ({ ncm, nome_item }));
}

// POST /api/pdf/extract
router.post('/extract', upload.single('pdf'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum PDF enviado' });

    try {
        const data = await pdfParse(req.file.buffer);
        const text = data.text;

        if (!text || text.trim().length === 0) {
            return res.status(422).json({ error: 'Não foi possível extrair texto do PDF (PDF escaneado/imagem?)' });
        }

        const ncmList = extractNcms(text);

        if (ncmList.length === 0) {
            return res.json({
                total: 0, found: 0, results: [], not_found: [],
                message: 'Nenhum NCM identificado no PDF. Verifique se o PDF contém texto (não é imagem escaneada).',
                text_preview: text.substring(0, 500),
            });
        }

        const ncmCodes = ncmList.map(x => x.ncm);

        const dbResult = await pool.query(
            `SELECT ncm, descricao, cclasstrib, desc_cclasstrib, cst, desc_cst
             FROM ncm_classificacao
             WHERE ncm = ANY($1::text[])
             ORDER BY ncm, cclasstrib`,
            [ncmCodes]
        );

        const grouped = {};
        for (const row of dbResult.rows) {
            if (!grouped[row.ncm]) {
                grouped[row.ncm] = {
                    ncm: row.ncm,
                    descricao: row.descricao,
                    classificacoes: [],
                };
            }
            grouped[row.ncm].classificacoes.push({
                cclasstrib: row.cclasstrib,
                desc_cclasstrib: row.desc_cclasstrib,
                cst: row.cst,
                desc_cst: row.desc_cst,
            });
        }

        // Monta resultados na ordem da nota, com nome_item
        const results = [];
        const notFound = [];
        for (const { ncm, nome_item } of ncmList) {
            if (grouped[ncm]) {
                results.push({ ...grouped[ncm], nome_item: nome_item || null });
            } else {
                notFound.push(ncm);
            }
        }

        res.json({
            total: ncmList.length,
            found: results.length,
            not_found: notFound,
            results,
        });
    } catch (err) {
        console.error('Erro ao processar PDF:', err.message);
        res.status(500).json({ error: 'Erro ao processar PDF: ' + err.message });
    }
});

module.exports = router;

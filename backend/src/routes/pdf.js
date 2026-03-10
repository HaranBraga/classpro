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
 * Extrai NCMs e os nomes dos itens de um PDF de NF-e / DANFE.
 */
function extractNcms(text) {
    const found = new Map();

    const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    const lines = clean.split('\n');

    /**
     * Tenta buscar o nome do item a partir da linha atual e anteriores.
     * Analisa múltiplos padrões de ERPs brasileiros.
     */
    function extractItemName(lineIndex, lineContent = '') {
        // Padrão 1: Tudo na mesma linha (Código + Nome + NCM colado)
        // Ex: "001409SACOS KRAFT-IR 35G 7,5 KG C/500UN481940000005.102PC4,00..."
        const mesmaLinhaMatch = lineContent.match(/^(\d{2,14})([A-Za-zÀ-ú].+)/);
        if (mesmaLinhaMatch && mesmaLinhaMatch[2].length > 3) {
            let nome = mesmaLinhaMatch[2].trim();
            // Evita capturar palavras curtas como ALIQ se o PDF montou errado
            if (!/^(ALIQ|VALOR|ICMS)/i.test(nome)) {
                nome = nome.replace(/(?:UN|PC|PEÇ|KG|CX|FR|GL|PCT|CJ|LT|MT|M2|M3|PR|RL)$/i, '').trim();
                nome = nome.replace(/[\s\d,.-]+$/, '').trim();
                // Retorna só se sobrar texto útil
                if (nome.length > 3) return nome.substring(0, 150); 
            }
        }

        // Padrão 2: Nome quebrado nas linhas de cima
        // ERPs como Stihl colocam "CódigoNome" na linha N-2, seguido de "CEST" ou "FCI" na N-1.
        for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 6); i--) {
            const l = lines[i].trim();
            if (!l) continue;

            // Ignora linhas que são só lixo de tabela ou identificadores fáceis
            if (/^(CEST|NCM|CFOP|CST|PIS|COFINS|IPI|ICMS|UNID|QTD|V\.UNIT|V\.TOTAL|ALIQ|VALOR|BASE|0|1)$/i.test(l)) continue;
            // Ignora a famigerada linha do FCI (ex: "N  FCI  EBB8F41F 139A 4643 A8A9 D19E29CAC591 CEST:0105100")
            if (l.includes('FCI') && /[A-F0-9]{4,}/.test(l)) continue;
            if (/^CEST:\d+/.test(l)) continue;
            
            // Ex: "1144-790-1702Tubo do punho" ou "000058ESSENCIA AL. 960ML BAUNILHA"
            // Suporta códigos hifenizados como 1144-790-1702
            const linhaAcimaMatch = l.match(/^([\d.-]{2,18})([A-Za-zÀ-ú].+)/);
            if (linhaAcimaMatch && linhaAcimaMatch[2].length > 3) {
                 let nome = linhaAcimaMatch[2].trim();
                 if (!/^(ALIQ|VALOR|ICMS)/i.test(nome)) {
                     nome = nome.replace(/(?:UN|PC|PEÇ|KG|CX|FR|GL|PCT|CJ|LT|MT|M2|M3|PR|RL)$/i, '').trim();
                     nome = nome.replace(/[\s\d,.-]+$/, '').trim();
                     return nome.substring(0, 150);
                 }
            }
            
            // Fallback: se for só texto limpo (ex: "Produto X") sem número de código anexado
            if (/^[A-Za-zÀ-ú]/.test(l) && l.length > 5 && !/^(ALIQ|VALOR|ICMS|Série|NF-e|DANFE|CHAVE)/i.test(l)) {
                return l.trim().substring(0, 150);
            }
        }
        return null;
    }

    let m;

    // Estratégia principal do seu DANFE:
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Padrão 1: 8 dígitos consecutivos isolados (não seguidos de outros números)
        const regexIso = /(?<![R$%/\d.,])(\d{8})(?!\d)/g;
        while ((m = regexIso.exec(line)) !== null) {
            const digits = m[1];
            const ch = parseInt(digits.substring(0, 2), 10);
            if (ch >= 1 && ch <= 97) {
                if (!found.has(digits)) {
                    const nome = extractItemName(i, line.substring(0, m.index));
                    found.set(digits, nome);
                }
            }
        }

        // Padrão 2: NCM colado com CST e CFOP — padrão DANFE (ex: ...481940000005.102...)
        const gluedDanfe = /(?<![R$%/\d.,])(\d{8})\d{3,4}[1-7]\.\d{3}/g;
        while ((m = gluedDanfe.exec(line)) !== null) {
            const digits = m[1];
            const ch = parseInt(digits.substring(0, 2), 10);
            if (ch >= 1 && ch <= 97) {
                if (!found.has(digits)) {
                    const nome = extractItemName(i, line.substring(0, m.index));
                    found.set(digits, nome);
                }
            }
        }
        
        // Estratégia de fallback: formato pontilhado XXXX.XX.XX
        const dotted = /\b(\d{4})\.(\d{2})\.(\d{2})\b/g;
        while ((m = dotted.exec(line)) !== null) {
            const digits = m[1] + m[2] + m[3];
            const ch = parseInt(m[1].substring(0, 2), 10);
            if (ch >= 1 && ch <= 97) {
                if (!found.has(digits)) {
                    const nome = extractItemName(i, line.substring(0, m.index));
                    found.set(digits, nome);
                }
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

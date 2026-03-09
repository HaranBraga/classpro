const fs = require('fs');
const pdfParse = require('pdf-parse');

const pdfPath = '../NFe 273022.pdf';

async function testPdf() {
    try {
        const buffer = fs.readFileSync(pdfPath);
        const data = await pdfParse(buffer);
        console.log('PDF text length:', data.text.length);

        const { extractNcms } = require('./src/routes/pdf.js');
        // We will just copy the strategy locally to test it, or require it if exported.
        // Oh, the function is NOT exported in pdf.js. Let me just copy it.
        const text = data.text;
        const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
        const found = new Set();
        const gluedDanfe = /(?<!\d)(\d{8})\d{3,4}[1-7]\.\d{3}/g;
        let m;
        while ((m = gluedDanfe.exec(clean)) !== null) {
            found.add(m[1]);
        }
        console.log('Glued NCMs found:', [...found]);

        fs.writeFileSync('pdf_text_output.txt', data.text);
        console.log('Output written to pdf_text_output.txt');
    } catch (err) {
        console.error('Error parsing PDF:', err);
    }
}

testPdf();

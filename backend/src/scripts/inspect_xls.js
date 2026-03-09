const XLSX = require('xlsx');
const path = require('path');

const xlsPath = '/data/cClassTrib por NCMNBS vinculada.xls';

const workbook = XLSX.readFile(xlsPath);
console.log('Sheets:', workbook.SheetNames);

const sheetName = workbook.SheetNames[0];
const ws = workbook.Sheets[sheetName];

// Ver range
console.log('Range:', ws['!ref']);

// Primeiras 5 linhas como JSON
const rows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
console.log('\n--- HEADER (linha 0) ---');
console.log(JSON.stringify(rows[0]));
console.log('\n--- LINHA 1 ---');
console.log(JSON.stringify(rows[1]));
console.log('\n--- LINHA 2 ---');
console.log(JSON.stringify(rows[2]));
console.log('\n--- LINHA 3 ---');
console.log(JSON.stringify(rows[3]));

// Ver com nomes de colunas
const rowsNamed = XLSX.utils.sheet_to_json(ws, { defval: '', range: 0 });
console.log('\n--- PRIMEIRA LINHA COM NOMES ---');
console.log(JSON.stringify(rowsNamed[0], null, 2));
console.log('\n--- SEGUNDA LINHA ---');
console.log(JSON.stringify(rowsNamed[1], null, 2));

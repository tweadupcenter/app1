// Génère des plans FICTIFS d'exemple à cotes connues (échelle 1:100) : PDF 2 pages, PNG et DXF (mm).
// Usage : node scripts/make-samples.cjs   (Playwright requis)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'samples');
// Logement 12 m x 8 m ; murs 20 cm ; cloison à x = 7 m ; barre d'échelle 5 m.
const plan = (title, extra) => `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
<rect width="297" height="210" fill="#fff"/>
<text x="20" y="20" font-size="6" font-family="Arial">${title} — PLAN FICTIF DE DÉMONSTRATION — échelle 1:100</text>
<g fill="none" stroke="#000" stroke-width="2"><rect x="41" y="41" width="118" height="78"/></g>
<line x1="110" y1="41" x2="110" y2="${extra ? 90 : 119}" stroke="#000" stroke-width="1"/>
<rect x="60" y="118" width="12" height="3" fill="#fff"/>
<line x1="40" y1="190" x2="90" y2="190" stroke="#c00" stroke-width="0.6"/>
<line x1="40" y1="186" x2="40" y2="194" stroke="#c00" stroke-width="0.6"/><line x1="90" y1="186" x2="90" y2="194" stroke="#c00" stroke-width="0.6"/>
<text x="58" y="186" font-size="5" fill="#c00" font-family="Arial">5 m</text>
<text x="80" y="36" font-size="4" font-family="Arial">12,00 m</text><text x="163" y="82" font-size="4" font-family="Arial">8,00 m</text>
</svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<html><body style="margin:0">${plan('Niveau RDC', false)}<div style="page-break-after:always"></div>${plan('Niveau R+1', true)}</body></html>`);
  await p.pdf({ path: path.join(out, 'plan-fictif-2-niveaux.pdf'), width: '297mm', height: '210mm', printBackground: true, pageRanges: '1-2' });
  const img = await b.newPage({ viewport: { width: 1286, height: 909 } }); // 297 mm à ~110 dpi
  await img.setContent(`<html><body style="margin:0">${plan('Niveau RDC', false).replace('width="297mm" height="210mm"', 'width="1286" height="909"')}</body></html>`);
  await img.screenshot({ path: path.join(out, 'plan-fictif-rdc.png') });
  await b.close();
  // DXF : mêmes murs, coordonnées en millimètres, $INSUNITS = 4
  const L = (x1, y1, x2, y2) => `0\nLINE\n8\nMURS\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
  const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n` +
    L(0, 0, 12000, 0) + L(12000, 0, 12000, 8000) + L(12000, 8000, 0, 8000) + L(0, 8000, 0, 0) + L(7000, 0, 7000, 8000) +
    `0\nCIRCLE\n8\nMOBILIER\n10\n3000\n20\n3000\n30\n0\n40\n500\n0\nENDSEC\n0\nEOF\n`;
  fs.writeFileSync(path.join(out, 'plan-fictif-rdc.dxf'), dxf);
  fs.writeFileSync(path.join(out, 'lots-exemple.csv'), '﻿reference;batiment;etage;type;pieces;chambres;surface_commerciale_m2;prix;prix_public;statut;caracteristiques\nD-0-01;;;apartment;3;2;82,5;1150000;oui;available;Terrasse|Parking\nD-0-02;;;studio;1;0;34;520000;non;available;\n');
  console.log('Échantillons générés dans', out);
})();

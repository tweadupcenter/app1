import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calibrateScale, polygonArea, splitWall, snapToVertices, pxToMeters, metersToPx } from '../src/geometry';
import { drawingSchema, drawingStats, validateDrawing, validatedOnly, scaleDrawing, type Drawing } from '../src/drawing';
import { buildFromDrawing, measureWalls } from '../src/build3d';
import { objectToGlb, inspectGlb, sanitizeNodeName } from '../src/glb';
import { buildDemoScene, demoSpec } from '../src/demo-scene';
import { parseLotCsv, toCsv, csvSafe } from '../src/csv';
import { casablancaLocalToIso, isoToCasablancaLocal, whatsappLink, formatMAD } from '../src/format';
import { detectFileType } from '../src/storage';

const sample = (): Drawing => ({
  version: 1, units: 'm',
  walls: [
    { id: 'w1', a: [0, 0], b: [8, 0], thickness: 0.2, height: 2.8, provenance: 'validated' },
    { id: 'w2', a: [8, 0], b: [8, 6], thickness: 0.2, height: 2.8, provenance: 'validated' },
    { id: 'w3', a: [8, 6], b: [0, 6], thickness: 0.2, height: 2.8, provenance: 'proposed' },
  ],
  rooms: [
    { id: 'r1', name: 'Séjour', points: [[0, 0], [8, 0], [8, 6], [0, 6]], lotId: '11111111-1111-4111-8111-111111111111', provenance: 'validated' },
    { id: 'r2', name: 'Cellier', points: [[0, 0], [1, 0], [1, 1], [0, 1]], provenance: 'estimated' },
  ],
  openings: [
    { id: 'o1', wallId: 'w1', kind: 'window', offset: 1, width: 2, height: 1.2, sill: 0.9, provenance: 'validated' },
    { id: 'o2', wallId: 'w1', kind: 'door', offset: 5, width: 0.9, height: 2.1, sill: 0, provenance: 'validated' },
  ],
});

describe('calibration et surfaces', () => {
  it('calcule une échelle à partir de deux points et d’une cote', () => {
    expect(calibrateScale([100, 100], [600, 100], 10)).toBeCloseTo(0.02, 10);
    expect(() => calibrateScale([1, 1], [1, 1], 3)).toThrow();
    expect(() => calibrateScale([0, 0], [1, 1], 0)).toThrow();
  });
  it('convertit pixels <-> mètres de façon réversible', () => {
    const m = pxToMeters([250, 400], 0.02, 1000);
    expect(m).toEqual([5, 12]);
    expect(metersToPx(m, 0.02, 1000)).toEqual([250, 400]);
  });
  it('calcule l’aire d’un polygone', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12);
    expect(polygonArea([[0, 0], [0, 3], [4, 3], [4, 0]])).toBe(12);
  });
  it('accroche aux sommets puis à la grille', () => {
    expect(snapToVertices([1.02, 0.98], [[1, 1]], 0.1, 0.5)).toEqual({ point: [1, 1], snapped: 'vertex' });
    expect(snapToVertices([1.3, 0.2], [[5, 5]], 0.1, 0.5).point).toEqual([1.5, 0]);
  });
});

describe('découpe des murs', () => {
  it('produit des blocs autour d’une fenêtre et d’une porte', () => {
    const p = splitWall(8, 2.8, [{ offset: 1, width: 2, sill: 0.9, height: 1.2 }, { offset: 5, width: 0.9, sill: 0, height: 2.1 }]);
    // plein 0-1, allège fenêtre, linteau fenêtre, plein 3-5, linteau porte, plein 5.9-8
    expect(p).toHaveLength(6);
    const area = p.reduce((s, x) => s + (x.s1 - x.s0) * (x.z1 - x.z0), 0);
    expect(area).toBeCloseTo(8 * 2.8 - 2 * 1.2 - 0.9 * 2.1, 6);
  });
});

describe('tracés', () => {
  it('valide le schéma et détecte les incohérences', () => {
    expect(drawingSchema.parse(sample())).toBeTruthy();
    const bad = sample();
    bad.openings.push({ id: 'o3', wallId: 'w1', kind: 'window', offset: 1.5, width: 2, height: 1, sill: 1, provenance: 'validated' });
    bad.openings.push({ id: 'o4', wallId: 'w2', kind: 'window', offset: 5.5, width: 2, height: 1, sill: 1, provenance: 'validated' });
    const issues = validateDrawing(bad);
    expect(issues.some((i) => i.elementId === 'o3' && /Chevauchement/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.elementId === 'o4' && /hors du mur/.test(i.message))).toBe(true);
  });
  it('ne compte que les pièces validées dans la surface calculée du lot', () => {
    const s = drawingStats(sample());
    expect(s.lotSurfacesValidated['11111111-1111-4111-8111-111111111111']).toBe(48);
    expect(s.counts).toEqual({ documented: 0, estimated: 1, proposed: 1, validated: 5 });
  });
  it('filtre les éléments validés et remet à l’échelle', () => {
    const v = validatedOnly(sample());
    expect(v.walls.map((w) => w.id)).toEqual(['w1', 'w2']);
    const sc = scaleDrawing(sample(), 2);
    expect(sc.walls[0].b).toEqual([16, 0]);
  });
});

describe('reconstruction 3D', () => {
  it('respecte les cotes validées (écart < 1 mm)', () => {
    const d = sample();
    const g = buildFromDrawing(d, { elevation: 3, levelKey: 'R1' });
    const checks = measureWalls(g, validatedOnly(d));
    expect(checks).toHaveLength(2);
    for (const c of checks) expect(Math.abs(c.delta)).toBeLessThan(0.001);
    // le mur proposé n'est pas construit
    expect(g.getObjectByName('wall_w3')).toBeUndefined();
    // hauteur : le bas des murs est à l'élévation du niveau
    const box = new THREE.Box3().setFromObject(g.getObjectByName('wall_w1')!);
    expect(box.min.y).toBeCloseTo(3, 6);
    expect(box.max.y).toBeCloseTo(5.8, 6);
  });
});

describe('GLB', () => {
  it('écrit un GLB valide relu avec ses noms de nœuds', () => {
    const g = buildFromDrawing(sample(), { elevation: 0, levelKey: 'R0' });
    const glb = objectToGlb(g);
    const info = inspectGlb(glb);
    expect(info.version).toBe(2);
    expect(info.nodeNames).toContain('wall_w1');
    expect(info.nodeNames).toContain('room_r1');
    expect(info.meshCount).toBeGreaterThan(3);
  });
  it('rejette un fichier qui n’est pas un GLB', () => {
    expect(() => inspectGlb(new TextEncoder().encode('hello world, not a glb file'))).toThrow(/Signature/);
  });
  it('génère la résidence fictive avec un nœud par lot', () => {
    const spec = demoSpec();
    const glb = objectToGlb(buildDemoScene(spec));
    const info = inspectGlb(glb);
    const lots = spec.buildings.flatMap((b) => b.lots);
    expect(lots).toHaveLength(43);
    for (const l of lots) expect(info.nodeNames).toContain(`lot_${l.reference}`);
    for (const k of ['pool', 'garden', 'sport', 'parking']) expect(info.nodeNames).toContain(`amenity_${k}`);
    expect(sanitizeNodeName('lot A.1:2')).toBe('lot_A12');
  });
});

describe('CSV des lots', () => {
  it('valide les lignes, signale erreurs et doublons', () => {
    const csv = 'reference;type;pieces;surface_commerciale_m2;prix;statut;caracteristiques\nA-1;apartment;3;85,5;1200000;available;Terrasse|Parking\nA-1;apartment;3;80;1;available;\nB-2;chateau;3;80;1;available;\nC-3;studio;1;30;;;';
    const r = parseLotCsv(csv);
    expect(r.rows.map((x) => x.reference)).toEqual(['A-1', 'C-3']);
    expect(r.rows[0].surface_commerciale_m2).toBe(85.5);
    expect(r.rows[0].caracteristiques).toEqual(['Terrasse', 'Parking']);
    expect(r.duplicatesInFile).toEqual(['A-1']);
    expect(r.errors.find((e) => e.line === 4)?.messages[0]).toMatch(/type/);
  });
  it('signale les colonnes obligatoires manquantes', () => {
    expect(parseLotCsv('ref;prix\nA;1').missingColumns).toEqual(['reference', 'type']);
  });
  it('neutralise les formules à l’export', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(toCsv([{ a: 1, b: ['x', 'y'] }], ['a', 'b'])).toContain('1;x|y');
  });
});

describe('formats et fichiers', () => {
  it('convertit l’heure locale de Casablanca', () => {
    const iso = casablancaLocalToIso('2026-11-10T10:30');
    expect(isoToCasablancaLocal(iso)).toBe('2026-11-10T10:30');
  });
  it('construit un lien WhatsApp prérempli', () => {
    expect(whatsappLink('+212 6 00 00 00 00', 'Bonjour A-1')).toBe('https://wa.me/212600000000?text=Bonjour%20A-1');
    expect(whatsappLink('', 'x')).toBeNull();
  });
  it('formate en MAD', () => {
    expect(formatMAD(1250000)).toMatch(/1.250.000/);
    expect(formatMAD(1250000)).toMatch(/MAD/);
  });
  it('détecte les types par signature', () => {
    expect(detectFileType(new TextEncoder().encode('%PDF-1.7 ...'))).toBe('pdf');
    expect(detectFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('png');
    expect(detectFileType(new TextEncoder().encode('  0\nSECTION\n  2\nHEADER'), 'plan.dxf')).toBe('dxf');
    expect(detectFileType(new TextEncoder().encode('%PDF'), 'x.png')).toBe('unknown');
  });
});

import { frameAt, totalDuration } from '../src/sequence';
describe('séquences caméra', () => {
  const vp: Record<string, any> = { a: { position: [0, 10, 0], target: [0, 0, 0], fov: 40 }, b: { position: [10, 10, 0], target: [10, 0, 0], fov: 60 } };
  const shots = [{ viewpoint_id: 'a', duration_s: 2, transition: 'cut' as const }, { viewpoint_id: 'b', duration_s: 4, transition: 'move' as const }];
  it('calcule la durée et interpole entre deux points de vue', () => {
    expect(totalDuration(shots)).toBe(6);
    expect(frameAt(shots, (id) => vp[id], 0)!.pose.position).toEqual([0, 10, 0]);
    const mid = frameAt(shots, (id) => vp[id], 2 + 1)!; // milieu du déplacement (2 s)
    expect(mid.pose.position[0]).toBeCloseTo(5, 5);
    expect(mid.shotIndex).toBe(1);
    expect(frameAt(shots, (id) => vp[id], 99)!.shotIndex).toBe(1);
  });
  it('ignore les points de vue supprimés', () => {
    expect(frameAt([{ viewpoint_id: 'zz', duration_s: 3, transition: 'cut' }], (id) => vp[id], 1)).toBeNull();
  });
});

// Écriture et lecture minimale de fichiers glTF 2.0 binaires (GLB).
// Fonctionne dans Node et dans le navigateur (pas de dépendance à FileReader).
import * as THREE from 'three';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

interface GltfJson {
  asset: { version: string; generator: string; copyright?: string };
  scene: number;
  scenes: { name?: string; nodes: number[] }[];
  nodes: any[];
  meshes: any[];
  materials: any[];
  accessors: any[];
  bufferViews: any[];
  buffers: { byteLength: number }[];
  extras?: Record<string, unknown>;
}

export interface GlbWriteOptions {
  generator?: string;
  copyright?: string;
  extras?: Record<string, unknown>;
}

/** Sérialise une hiérarchie three.js (Mesh + MeshStandardMaterial) en GLB. */
export function objectToGlb(root: THREE.Object3D, opts: GlbWriteOptions = {}): Uint8Array<ArrayBuffer> {
  const json: GltfJson = {
    asset: { version: '2.0', generator: opts.generator ?? 'Tweadup Immo 360', ...(opts.copyright ? { copyright: opts.copyright } : {}) },
    scene: 0,
    scenes: [{ name: root.name || 'scene', nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
    ...(opts.extras ? { extras: opts.extras } : {}),
  };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const matIndex = new Map<string, number>();
  const meshIndex = new Map<string, number>();

  const pushView = (data: ArrayBufferView, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes.slice());
    byteLength += bytes.byteLength;
    return json.bufferViews.length - 1;
  };

  const material = (m: THREE.Material): number => {
    const key = m.uuid;
    if (matIndex.has(key)) return matIndex.get(key)!;
    const std = m as THREE.MeshStandardMaterial;
    const c = std.color ?? new THREE.Color(1, 1, 1);
    const e = std.emissive ?? new THREE.Color(0, 0, 0);
    const opacity = m.transparent ? m.opacity : 1;
    json.materials.push({
      name: m.name || undefined,
      pbrMetallicRoughness: {
        baseColorFactor: [c.r, c.g, c.b, opacity],
        metallicFactor: std.metalness ?? 0,
        roughnessFactor: std.roughness ?? 1,
      },
      emissiveFactor: [e.r, e.g, e.b],
      ...(m.transparent ? { alphaMode: 'BLEND' } : {}),
      ...(m.side === THREE.DoubleSide ? { doubleSided: true } : {}),
    });
    matIndex.set(key, json.materials.length - 1);
    return json.materials.length - 1;
  };

  const mesh = (obj: THREE.Mesh): number => {
    const key = obj.geometry.uuid + '|' + (Array.isArray(obj.material) ? obj.material[0].uuid : obj.material.uuid);
    if (meshIndex.has(key)) return meshIndex.get(key)!;
    let g = obj.geometry as THREE.BufferGeometry;
    if (!g.getAttribute('normal')) { g = g.clone(); g.computeVertexNormals(); }
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const posArr = new Float32Array(pos.count * 3);
    const norArr = new Float32Array(pos.count * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.count; i++) {
      const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      for (let k = 0; k < 3; k++) { posArr[i * 3 + k] = v[k]; if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
      norArr[i * 3] = nor.getX(i); norArr[i * 3 + 1] = nor.getY(i); norArr[i * 3 + 2] = nor.getZ(i);
    }
    const posView = pushView(posArr, ARRAY_BUFFER);
    json.accessors.push({ bufferView: posView, componentType: FLOAT, count: pos.count, type: 'VEC3', min, max });
    const posAcc = json.accessors.length - 1;
    const norView = pushView(norArr, ARRAY_BUFFER);
    json.accessors.push({ bufferView: norView, componentType: FLOAT, count: pos.count, type: 'VEC3' });
    const norAcc = json.accessors.length - 1;
    const prim: any = { attributes: { POSITION: posAcc, NORMAL: norAcc }, mode: 4 };
    if (g.index) {
      const idx = new Uint32Array(g.index.count);
      for (let i = 0; i < g.index.count; i++) idx[i] = g.index.getX(i);
      const v = pushView(idx, ELEMENT_ARRAY_BUFFER);
      json.accessors.push({ bufferView: v, componentType: UNSIGNED_INT, count: idx.length, type: 'SCALAR' });
      prim.indices = json.accessors.length - 1;
    }
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    prim.material = material(mat);
    json.meshes.push({ name: obj.name || undefined, primitives: [prim] });
    meshIndex.set(key, json.meshes.length - 1);
    return json.meshes.length - 1;
  };

  const node = (obj: THREE.Object3D): number => {
    const n: any = { name: obj.name || undefined };
    if (obj.position.lengthSq() > 0) n.translation = obj.position.toArray();
    if (obj.quaternion.w !== 1) n.rotation = obj.quaternion.toArray();
    if (obj.scale.x !== 1 || obj.scale.y !== 1 || obj.scale.z !== 1) n.scale = obj.scale.toArray();
    if (obj.userData && Object.keys(obj.userData).length) n.extras = obj.userData;
    json.nodes.push(n);
    const idx = json.nodes.length - 1;
    if ((obj as THREE.Mesh).isMesh) n.mesh = mesh(obj as THREE.Mesh);
    const kids = obj.children.map(node);
    if (kids.length) n.children = kids;
    return idx;
  };

  json.scenes[0].nodes.push(node(root));
  json.buffers.push({ byteLength });
  // supprime les clés undefined
  const jsonText = JSON.stringify(json);
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(jsonText);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const p = new Uint8Array(jsonBytes.length + jsonPad);
    p.set(jsonBytes); p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const binPad = (4 - (byteLength % 4)) % 4;
  const binLen = byteLength + binPad;
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  let off = 20 + jsonBytes.length;
  dv.setUint32(off, binLen, true);
  dv.setUint32(off + 4, 0x004e4942, true); // 'BIN\0'
  off += 8;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export interface GlbInspection {
  version: number;
  byteLength: number;
  generator?: string;
  nodeNames: string[];
  meshCount: number;
  materialCount: number;
  textureCount: number;
  triangleEstimate: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
  warnings: string[];
}

/** Lecture de l'en-tête et du chunk JSON pour valider un GLB et lister ses nœuds. */
export function inspectGlb(buf: Uint8Array): GlbInspection {
  if (buf.byteLength < 20) throw new Error('Fichier trop court pour être un GLB');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Signature GLB absente (magic "glTF")');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Version glTF ${version} non prise en charge (2 attendue)`);
  const length = dv.getUint32(8, true);
  if (length !== buf.byteLength) throw new Error(`Longueur déclarée ${length} différente de la taille réelle ${buf.byteLength}`);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('Premier chunk JSON absent');
  if (20 + jsonLen > buf.byteLength) throw new Error('Chunk JSON tronqué');
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const warnings: string[] = [];
  const nodeNames: string[] = (json.nodes ?? []).map((n: any, i: number) => (typeof n.name === 'string' && n.name ? n.name : `#node${i}`));
  const unnamed = nodeNames.filter((n) => n.startsWith('#node')).length;
  if (unnamed) warnings.push(`${unnamed} nœud(s) sans nom : ils ne pourront pas être associés de façon fiable.`);
  const dup = nodeNames.filter((n, i) => nodeNames.indexOf(n) !== i);
  if (dup.length) warnings.push(`Noms de nœuds en double : ${[...new Set(dup)].slice(0, 10).join(', ')}`);
  let tri = 0;
  for (const m of json.meshes ?? []) for (const p of m.primitives ?? []) {
    const acc = json.accessors?.[p.indices ?? p.attributes?.POSITION];
    if (acc) tri += Math.floor(acc.count / 3);
  }
  if (tri > 2_000_000) warnings.push(`Modèle lourd (~${tri.toLocaleString('fr-FR')} triangles) : optimisation recommandée pour le web.`);
  const extReq: string[] = json.extensionsRequired ?? [];
  const supported = ['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_materials_emissive_strength'];
  for (const e of extReq) if (!supported.includes(e)) warnings.push(`Extension requise non gérée par la visionneuse : ${e}`);
  return {
    version, byteLength: length, generator: json.asset?.generator, nodeNames,
    meshCount: (json.meshes ?? []).length, materialCount: (json.materials ?? []).length, textureCount: (json.textures ?? []).length,
    triangleEstimate: tri, extensionsUsed: json.extensionsUsed ?? [], extensionsRequired: extReq, warnings,
  };
}

/**
 * Même normalisation que THREE.PropertyBinding.sanitizeNodeName utilisée par GLTFLoader :
 * les associations sont stockées avec le nom brut et comparées sous forme normalisée.
 */
export function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
}

import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { PortType, Terrain } from '../../shared/types';
import { ResourceGlyph } from '../board/icons';
import { seedFrom } from '../board/terrain';

/** Ground colours: base, and two speckle tones that give the surface a grain. */
const GROUND: Record<Terrain, [string, string, string]> = {
  forest: ['#2f7a45', '#23613a', '#3f8f55'],
  fields: ['#d9b04a', '#c49532', '#e8c768'],
  pasture: ['#8dbd4c', '#78a83c', '#a3cf62'],
  hills: ['#b8683c', '#9c5230', '#cc7b4c'],
  mountains: ['#7e8a93', '#69747d', '#95a0a8'],
  desert: ['#e3cf9f', '#d4bc86', '#efdfb6'],
  sea: ['#1a5674', '#123a52', '#236685'],
  gold: ['#e9c25a', '#cf9b1c', '#f6d574'],
};

const cache = new Map<string, THREE.Texture>();

function remember(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Top-face texture of a tile: base colour plus a few thousand soft speckles. */
export function groundTexture(terrain: Terrain): THREE.Texture {
  return remember(`ground-${terrain}`, () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const [base, dark, lit] = GROUND[terrain];
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const r = seedFrom(terrain);
    for (let i = 0; i < 1400; i++) {
      ctx.globalAlpha = 0.25 + r() * 0.35;
      ctx.fillStyle = r() < 0.5 ? dark : lit;
      ctx.beginPath();
      ctx.arc(r() * size, r() * size, 1 + r() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Extrude caps take UVs straight from shape coordinates (-1..1).
    tex.repeat.set(0.5, 0.5);
    tex.offset.set(0.5, 0.5);
    return tex;
  });
}

function svgTexture(key: string, svg: string): THREE.Texture {
  return remember(key, () => {
    const tex = new THREE.TextureLoader().load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

const SERIF = "Bitter, Georgia, 'Times New Roman', serif";

/** The face of a number chit: numeral plus probability dots, 6 and 8 in red. */
export function tokenTexture(token: number): THREE.Texture {
  const hot = token === 6 || token === 8;
  const ink = hot ? '#a8281f' : '#2c3239';
  const dots = 6 - Math.abs(7 - token);
  const dotMarks = Array.from(
    { length: dots },
    (_, i) => `<circle cx="${128 + (i - (dots - 1) / 2) * 20}" cy="196" r="7" fill="${ink}"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><radialGradient id="f" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e6d8b8"/></radialGradient></defs>
    <circle cx="128" cy="128" r="126" fill="url(#f)"/>
    <circle cx="128" cy="128" r="112" fill="none" stroke="#b9a684" stroke-width="3" opacity="0.6"/>
    <text x="128" y="118" text-anchor="middle" dominant-baseline="central" font-family="${SERIF}" font-weight="800" font-size="${token >= 10 ? 104 : 120}" fill="${ink}">${token}</text>
    ${dotMarks}
  </svg>`;
  return svgTexture(`token-${token}`, svg);
}

const PORT_COLOR: Record<Exclude<PortType, 'any'>, string> = {
  brick: '#f09a66',
  lumber: '#64cf8d',
  wool: '#c7e874',
  grain: '#ffdf78',
  ore: '#c3d0dd',
};

/** Harbour sign: resource glyph and trade rate on a dark enamel disc. */
export function portTexture(type: PortType): THREE.Texture {
  const inner =
    type === 'any'
      ? `<text x="128" y="132" text-anchor="middle" dominant-baseline="central" font-family="${SERIF}" font-weight="700" font-size="92" fill="#eedcb8">3:1</text>`
      : `<svg x="58" y="36" width="140" height="140" viewBox="0 0 24 24" color="${PORT_COLOR[type]}">${renderToStaticMarkup(
          createElement(ResourceGlyph, { resource: type }),
        )}</svg>
         <text x="128" y="206" text-anchor="middle" font-family="${SERIF}" font-weight="700" font-size="54" fill="${PORT_COLOR[type]}">2:1</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <circle cx="128" cy="128" r="126" fill="#6e4a28"/>
    <circle cx="128" cy="128" r="108" fill="#12293a"/>
    ${inner}
  </svg>`;
  return svgTexture(`port-${type}`, svg);
}

/** Long-grain planks for the frame. Extrude UVs are world units, so it tiles every few hexes. */
export function woodTexture(): THREE.Texture {
  return remember('wood', () => {
    const w = 512;
    const h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#7a4d29';
    ctx.fillRect(0, 0, w, h);
    const r = seedFrom('wood');
    for (let i = 0; i < 90; i++) {
      const y = r() * h;
      ctx.strokeStyle = r() < 0.5 ? '#5e3a1d' : '#946239';
      ctx.globalAlpha = 0.25 + r() * 0.4;
      ctx.lineWidth = 0.6 + r() * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x / 70 + i) * (1 + r() * 3));
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.35, 0.35);
    tex.anisotropy = 4;
    return tex;
  });
}

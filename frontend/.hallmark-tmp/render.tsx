import { readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FramedAvatar } from '../src/components/ui/FramedAvatar';
import { FRAMES, unlockText } from '../src/lib/rewards';

const css = readFileSync('src/index.css', 'utf8');
const items = [{ id: null as string | null, label: 'Không viền', unlock: null as string | null }, ...FRAMES.map((f) => ({ id: f.id as string | null, label: f.label, unlock: unlockText(f.unlock) as string | null }))];
const tiles = items.map((it) =>
  createElement('div', { className: 'tile', key: it.label },
    createElement('div', { className: 'stage' }, createElement(FramedAvatar, { size: 96, initials: 'MA', color: '#0891B2', frame: it.id })),
    createElement('div', { className: 'label' }, it.label),
    createElement('div', { className: 'hint' }, it.unlock ?? 'Mặc định'),
  ),
);
const body = renderToStaticMarkup(createElement('div', { className: 'grid' }, tiles));
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Frames preview</title><style>${css}
body{margin:0;background:#0B1220;color:#E2E8F0;font-family:Inter,system-ui,sans-serif;padding:32px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;max-width:1100px;margin:0 auto}
.tile{display:grid;gap:8px;justify-items:center}
.stage{width:100%;height:170px;display:grid;place-items:center;background:#0F172A;border:1px solid #1E293B;border-radius:14px}
.label{font-weight:700;font-size:15px}.hint{font-size:12px;color:#94A3B8;text-align:center}
</style></head><body>${body}</body></html>`;
writeFileSync(process.argv[2], html);
console.log('wrote', process.argv[2], tiles.length, 'tiles');

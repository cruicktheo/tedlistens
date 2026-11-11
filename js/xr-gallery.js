// The VR gallery: in a headset, the page's content is laid out around the model as an exhibition.
//
//   - A tall foam board behind the model carries the name, introduction and how-to.
//   - A board to the left carries the portrait, about text, toolkit and education.
//   - A board to the right carries contact buttons you can select.
//   - Each block wears a small tag (company and years) that turns to face you.
//   - Point at a block and its full role card unfolds above it; pick it up and the card comes with it.
//   - The front edge of the tabletop is printed with the direction of time.
//
// All text is read from the page itself, so the HTML stays the single source of truth.

import * as THREE from 'three';

const INK = '#1D2125';
const SLATE = '#5B636A';
const ULTRA = '#2643F0';
const FOAM = '#F6F7F5';
const RULE = 'rgba(29, 33, 37, 0.16)';
const FAMILY = 'Archivo, system-ui, sans-serif';

// ---------- Canvas typesetting ----------

function setFont(ctx, it) {
  ctx.font = `${it.weight || 400} ${it.size}px ${FAMILY}`;
  if ('fontStretch' in ctx) ctx.fontStretch = it.stretch || 'normal';
  if ('letterSpacing' in ctx) ctx.letterSpacing = it.tracking || '0px';
}

function wrapLines(ctx, text, maxW) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Lays out a list of items in a column; draws them when `draw` is true. Returns the new y.
function layout(ctx, items, x, y, w, draw) {
  for (const it of items) {
    if (it.space) { y += it.space; continue; }

    if (it.rule) {
      const t = it.weight || 2;
      if (draw) { ctx.fillStyle = it.color || RULE; ctx.fillRect(x, y, w, t); }
      y += t + (it.gap ?? 0);
      continue;
    }

    if (it.image) {
      const iw = w * (it.scale || 1);
      const ih = iw * it.image.naturalHeight / it.image.naturalWidth;
      if (draw) {
        ctx.save();
        ctx.filter = it.filter || 'none';
        ctx.drawImage(it.image, x, y, iw, ih);
        ctx.restore();
      }
      y += ih + (it.gap ?? 0);
      continue;
    }

    if (it.split) {
      const gap = it.gutter ?? 48;
      const ratio = it.ratio || it.split.map(() => 1);
      const total = ratio.reduce((a, b) => a + b, 0);
      const free = w - gap * (it.split.length - 1);
      let cx = x, maxY = y;
      it.split.forEach((col, i) => {
        const cw = free * ratio[i] / total;
        maxY = Math.max(maxY, layout(ctx, col, cx, y, cw, draw));
        cx += cw + gap;
      });
      y = maxY + (it.gap ?? 0);
      continue;
    }

    if (it.list) {
      setFont(ctx, it);
      const cols = it.columns || 1;
      const cg = it.colGap ?? 40;
      const cw = (w - cg * (cols - 1)) / cols;
      const rowH = it.size * (it.rowHeight || 2.0);
      const rows = Math.ceil(it.list.length / cols);
      if (draw) {
        ctx.textBaseline = 'middle';
        it.list.forEach((t, i) => {
          const c = Math.floor(i / rows), r = i % rows;
          const cx = x + c * (cw + cg), cy = y + r * rowH;
          ctx.fillStyle = it.color || INK;
          ctx.fillText(t, cx, cy + rowH / 2);
          ctx.fillStyle = RULE;
          ctx.fillRect(cx, cy + rowH - 2, cw, 2);
        });
      }
      y += rows * rowH + (it.gap ?? 0);
      continue;
    }

    // Plain text, wrapped to the column.
    setFont(ctx, it);
    const lh = it.size * (it.lh || 1.4);
    const lines = wrapLines(ctx, it.text, w);
    if (draw) {
      ctx.fillStyle = it.color || INK;
      ctx.textBaseline = 'alphabetic';
      lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh + (lh + it.size * 0.7) / 2));
    }
    y += lines.length * lh + (it.gap ?? 0);
  }
  return y;
}

let maxAnisotropy = 1;

// A flat card: the items typeset onto a canvas, mapped onto a plane `width` metres wide.
function makeCard({ width, pxPerM, pad, items, bg = FOAM, border = false, accent = null }) {
  const W = Math.round(width * pxPerM);
  const p = pad ?? Math.round(W * 0.06);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const H = Math.ceil(layout(ctx, items, p, p, W - 2 * p, false) + p);

  canvas.height = H;   // resets the context
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (border) {
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  }
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, Math.max(6, W * 0.012), H);
  }
  layout(ctx, items, p, p, W - 2 * p, true);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  const height = H / pxPerM;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, fog: false })
  );
  return { mesh, width, height };
}

// A free-standing foam board, from the floor up to just above its card, turned to face the visitor.
function makeBoard(card, { x, z, centreY }) {
  const group = new THREE.Group();
  const top = centreY + card.height / 2 + 0.05;
  const slabGeo = new THREE.BoxGeometry(card.width + 0.1, top, 0.03);
  slabGeo.translate(0, top / 2, 0);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: FOAM, roughness: 0.85 }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slabGeo),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 })
  );
  card.mesh.position.set(0, centreY, 0.0155);
  group.add(slab, edges, card.mesh);
  group.position.set(x, 0, z);
  group.rotation.y = Math.atan2(-x, -z);   // face the origin, where the visitor starts
  return { group, slab };
}

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const text = sel => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';

// ---------- The gallery ----------

export function createXRGallery({ renderer, stage, model, camera, blocks, controllers, board }) {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const root = new THREE.Group();
  root.visible = false;
  stage.add(root);   // the stage is placed where the visitor stands, facing the way they face

  const modelExtras = new THREE.Group();   // things that live in model space, like the timeline strip
  modelExtras.visible = false;
  model.add(modelExtras);

  const raycaster = new THREE.Raycaster();
  const blockMeshes = blocks.map(b => b.mesh);
  const buttons = [];        // selectable contact buttons
  const solids = [];         // boards, so pointer beams stop at them
  const tags = [];           // per block: small floating tag
  const details = [];        // per block: full role card
  let built = false;
  let building = null;

  const tmp = new THREE.Vector3();
  const head = new THREE.Vector3();

  function faceHead(obj) {
    obj.rotation.set(0, Math.atan2(head.x - obj.position.x, head.z - obj.position.z), 0);
  }

  function makeLeader(color, opacity) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }
  function setLeader(line, a, b) {
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  async function build() {
    // Make sure the canvas has the real typeface before setting anything.
    try {
      await Promise.all(['400', '600', '650', '700', '760'].map(w => document.fonts.load(`${w} 40px Archivo`)));
    } catch { /* fall back to system type */ }
    const portrait = await loadImage('documents/ted.png');

    // Name, introduction and how-to, behind the model.
    const title = makeCard({
      width: 2.1, pxPerM: 1100, pad: 110,
      items: [
        { text: text('h1'), size: 190, weight: 760, stretch: 'expanded', tracking: '-4px', lh: 0.95, gap: 50 },
        { text: text('.lede'), size: 62, lh: 1.35, gap: 40 },
        { rule: true, gap: 34 },
        { text: 'Each block on the table is a job I\'ve held; its height is the years I spent there. Point at one to read about it. Pull the trigger, or pinch, to pick it up. The ink runs from the past on the right towards now on the left, and your hands part it. Squeeze a grip button to bring the table back in front of you.', size: 40, color: SLATE, lh: 1.45 },
      ],
    });
    const titleBoard = makeBoard(title, { x: 0, z: -2.3, centreY: 1.6 });

    // About, to the left.
    const paras = [...document.querySelectorAll('.about-text > p')].slice(0, 2).map(p => p.textContent.replace(/\s+/g, ' ').trim());
    const toolkit = [...document.querySelectorAll('.toolkit li')].map(li => li.textContent.trim());
    const education = [...document.querySelectorAll('.education > div')].map(d => ({
      school: d.querySelector('dt')?.textContent.trim() || '',
      detail: d.querySelector('dd')?.textContent.trim() || '',
    }));
    const about = makeCard({
      width: 1.15, pxPerM: 1120, pad: 80,
      items: [
        { text: 'About', size: 84, weight: 700, stretch: 'expanded', gap: 36 },
        {
          split: [
            portrait ? [{ image: portrait, filter: 'grayscale(1) contrast(1.05)' }] : [],
            [
              { text: paras[0] || '', size: 38, lh: 1.42, gap: 22 },
              { text: paras[1] || '', size: 32, lh: 1.45 },
            ],
          ],
          ratio: [0.8, 1.6], gutter: 50, gap: 44,
        },
        { text: 'What I work with', size: 34, weight: 650, gap: 6 },
        { list: toolkit, columns: 3, size: 30, rowHeight: 1.9, gap: 34 },
        { text: 'Education', size: 34, weight: 650, gap: 12 },
        ...education.flatMap(e => [
          { text: e.school, size: 30, weight: 600, lh: 1.3 },
          { text: e.detail, size: 28, color: SLATE, lh: 1.3, gap: 14 },
        ]),
      ],
    });
    const aboutBoard = makeBoard(about, { x: -1.6, z: -1.0, centreY: 1.35 });

    // Contact, to the right: a heading card plus a selectable button per link.
    const contactHead = makeCard({
      width: 0.85, pxPerM: 1150, pad: 70,
      items: [
        { text: 'Contact', size: 84, weight: 700, stretch: 'expanded', gap: 26 },
        { text: text('.contact > p'), size: 36, lh: 1.42, gap: 10 },
        { text: 'Select one of these to open it. Your headset will leave VR to show it.', size: 28, color: SLATE, lh: 1.4 },
      ],
    });
    const emailEl = document.querySelector('.email');
    const links = [
      ...(emailEl ? [{ label: emailEl.textContent.trim(), href: emailEl.href, big: true }] : []),
      ...[...document.querySelectorAll('.contact-links a')].map(a => ({ label: a.textContent.trim(), href: a.href })),
    ];
    const contactGroup = new THREE.Group();
    // Stack: heading at the top, buttons beneath, all on one board.
    const buttonCards = links.map(l => {
      const card = makeCard({
        width: 0.73, pxPerM: 1300, pad: 36, border: true, accent: l.big ? ULTRA : null,
        items: [{ text: l.label, size: l.big ? 64 : 46, weight: l.big ? 720 : 600, stretch: l.big ? 'expanded' : 'normal', color: l.big ? ULTRA : INK, lh: 1.25 }],
      });
      card.mesh.userData.href = l.href;
      buttons.push(card.mesh);
      return card;
    });
    const stackGap = 0.025;
    const buttonsHeight = buttonCards.reduce((h, c) => h + c.height + stackGap, 0);
    const combinedHeight = contactHead.height + buttonsHeight + 0.04;
    // A blank card the size of the whole stack, so the board sizes itself around everything.
    const backing = { mesh: new THREE.Group(), width: contactHead.width, height: combinedHeight };
    const contactBoard = makeBoard(backing, { x: 1.6, z: -1.0, centreY: 1.3 });
    const backPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(contactHead.width, combinedHeight),
      new THREE.MeshBasicMaterial({ color: FOAM, toneMapped: false, fog: false })
    );
    backing.mesh.add(backPlate);
    let y = combinedHeight / 2 - contactHead.height / 2;
    contactHead.mesh.position.set(0, y, 0.001);
    backing.mesh.add(contactHead.mesh);
    y -= contactHead.height / 2 + 0.04;
    for (const c of buttonCards) {
      c.mesh.position.set(0, y - c.height / 2, 0.004);
      c.mesh.userData.restZ = 0.004;
      backing.mesh.add(c.mesh);
      y -= c.height + stackGap;
    }
    contactGroup.add(contactBoard.group);

    root.add(titleBoard.group, aboutBoard.group, contactGroup);
    solids.push(titleBoard.slab, aboutBoard.slab, contactBoard.slab);

    // Tags and role cards for each block.
    for (const b of blocks) {
      const li = document.getElementById(b.role.id);
      const tag = makeCard({
        width: 0.2, pxPerM: 2600, pad: 26, border: true,
        items: [
          { text: b.role.name, size: 48, weight: 650, color: b.role.current ? ULTRA : INK, lh: 1.2 },
          { text: b.role.years, size: 38, color: SLATE, lh: 1.25 },
        ],
      });
      const tagLeader = makeLeader(INK, 0.35);
      root.add(tag.mesh, tagLeader);
      tags.push({ block: b, card: tag, leader: tagLeader, fade: 1 });

      const desc = li?.querySelector('div > p:last-child')?.textContent.replace(/\s+/g, ' ').trim() || '';
      const detail = makeCard({
        width: 0.5, pxPerM: 2200, pad: 60, border: true, accent: ULTRA,
        items: [
          { text: li?.querySelector('.years')?.textContent.replace(/\s+/g, ' ').trim() || b.role.years, size: 32, color: ULTRA, weight: 600, gap: 8 },
          { text: li?.querySelector('h3')?.textContent.trim() || '', size: 64, weight: 720, stretch: 'expanded', lh: 1.1, gap: 6 },
          { text: li?.querySelector('.company')?.textContent.trim() || b.role.name, size: 36, color: SLATE, gap: 24 },
          { rule: true, gap: 22 },
          { text: desc, size: 34, lh: 1.48 },
        ],
      });
      const detailLeader = makeLeader(ULTRA, 0.8);
      detail.mesh.visible = detailLeader.visible = false;
      root.add(detail.mesh, detailLeader);
      details.push({ block: b, card: detail, leader: detailLeader, t: 0 });
    }

    // The direction of time, printed along the front edge of the tabletop.
    const bw = board.geometry.parameters.width;
    const bh = board.geometry.parameters.height;
    const bd = board.geometry.parameters.depth;
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = 4096;
    stripCanvas.height = Math.round(4096 * bh / bw);
    const sc = stripCanvas.getContext('2d');
    sc.fillStyle = '#D5D8D4';
    sc.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    const fs = stripCanvas.height * 0.5;
    setFont(sc, { size: fs, weight: 650 });
    sc.fillStyle = INK;
    sc.textBaseline = 'middle';
    const mid = stripCanvas.height / 2;
    sc.textAlign = 'left';
    sc.fillText('Now', fs * 0.8, mid);
    sc.textAlign = 'right';
    sc.fillText('2015', stripCanvas.width - fs * 0.8, mid);
    sc.textAlign = 'center';
    setFont(sc, { size: fs * 0.8 });
    sc.fillStyle = SLATE;
    sc.fillText('time and water flow this way', stripCanvas.width / 2, mid);
    // Arrow pointing left, either side of the caption.
    sc.strokeStyle = ULTRA;
    sc.fillStyle = ULTRA;
    sc.lineWidth = Math.max(2, fs * 0.08);
    const captionHalf = sc.measureText('time and water flow this way').width / 2 + fs;
    const ax0 = fs * 4, ax1 = stripCanvas.width - fs * 4.5;
    sc.beginPath();
    sc.moveTo(ax0, mid); sc.lineTo(stripCanvas.width / 2 - captionHalf, mid);
    sc.moveTo(stripCanvas.width / 2 + captionHalf, mid); sc.lineTo(ax1, mid);
    sc.stroke();
    sc.beginPath();
    sc.moveTo(ax0 - fs * 0.5, mid); sc.lineTo(ax0 + fs * 0.2, mid - fs * 0.35); sc.lineTo(ax0 + fs * 0.2, mid + fs * 0.35);
    sc.closePath(); sc.fill();
    const stripTex = new THREE.CanvasTexture(stripCanvas);
    stripTex.colorSpace = THREE.SRGBColorSpace;
    stripTex.anisotropy = maxAnisotropy;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshBasicMaterial({ map: stripTex, toneMapped: false, fog: false })
    );
    strip.position.set(board.position.x, board.position.y, board.position.z + bd / 2 + 0.003);
    modelExtras.add(strip);

    built = true;
  }

  function setVisible(on) {
    root.visible = on;
    modelExtras.visible = on;
    if (on && !built && !building) building = build();
    if (!on) for (const b of blocks) b.edgeMat.opacity = 0.35;
  }

  // Called from selectstart; returns true if the press was used by the gallery.
  function select(controller) {
    if (!built) return false;
    raycaster.setFromXRController(controller);
    const hit = raycaster.intersectObjects([...buttons, ...blockMeshes], false)[0];
    if (!hit || !hit.object.userData.href) return false;
    const href = hit.object.userData.href;
    if (href.startsWith('mailto:')) window.location.href = href;
    else window.open(href, '_blank', 'noopener');
    return true;
  }

  function update(dt) {
    if (!built) return;
    // Work in the stage's frame: tags and cards are its children, and it may be turned.
    root.updateMatrixWorld();
    camera.getWorldPosition(head);
    root.worldToLocal(head);

    // What each controller points at; beams stop where they hit.
    let pointed = null;
    let pressed = null;
    const targets = [...blockMeshes, ...buttons, ...solids];
    for (const c of controllers) {
      const beam = c.children[0];
      if (!c.visible) continue;
      raycaster.setFromXRController(c);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (beam) beam.scale.z = hit ? hit.distance : 2;
      if (!hit) continue;
      if (hit.object.userData.block && !pointed) pointed = hit.object.userData.block;
      if (hit.object.userData.href) pressed = hit.object;
    }
    for (const btn of buttons) {
      const on = btn === pressed;
      btn.position.z += ((on ? btn.userData.restZ + 0.012 : btn.userData.restZ) - btn.position.z) * Math.min(1, dt * 14);
      btn.material.color.setHex(on ? 0xe6eaff : 0xffffff);
    }

    const held = controllers.map(c => c.userData.held).find(Boolean) || null;
    const active = held || pointed;
    for (const b of blocks) b.edgeMat.opacity = b === active ? 1 : 0.35;

    // Small tags above every block, facing the visitor.
    for (const t of tags) {
      const b = t.block;
      const top = tmp.set(0, b.height * b.group.scale.y, 0);
      b.group.localToWorld(top);
      root.worldToLocal(top);
      const tx = top.x, ty = top.y, tz = top.z;
      const showing = details.find(d => d.block === b && d.t > 0.05);
      t.fade += ((showing ? 0 : 1) - t.fade) * Math.min(1, dt * 10);
      const m = t.card.mesh;
      m.visible = t.leader.visible = t.fade > 0.02;
      m.material.opacity = t.fade;
      m.position.set(tx, ty + 0.045 + t.card.height / 2, tz);
      faceHead(m);
      setLeader(t.leader, new THREE.Vector3(tx, ty, tz), tmp.set(tx, ty + 0.045, tz));
      t.leader.material.opacity = 0.35 * t.fade;
    }

    // The role card for whichever block is held or pointed at, unfolding upwards from it.
    for (const d of details) {
      const target = d.block === active ? 1 : 0;
      d.t += (target - d.t) * Math.min(1, dt * (target ? 9 : 14));
      const m = d.card.mesh;
      m.visible = d.leader.visible = d.t > 0.01;
      if (!m.visible) continue;
      const b = d.block;
      const top = new THREE.Vector3(0, b.height * b.group.scale.y, 0);
      b.group.localToWorld(top);
      root.worldToLocal(top);
      const ease = 1 - Math.pow(1 - d.t, 3);
      const lift = 0.06 + 0.04 * ease;
      m.scale.set(0.85 + 0.15 * ease, ease, 1);
      m.position.set(top.x, top.y + lift + (d.card.height / 2) * ease, top.z);
      m.material.opacity = ease;
      faceHead(m);
      setLeader(d.leader, top, tmp.set(top.x, top.y + lift, top.z));
      d.leader.material.opacity = 0.8 * ease;
    }
  }

  return { setVisible, select, update };
}

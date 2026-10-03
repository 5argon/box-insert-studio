import { describe, expect, it } from 'vitest';
import { setConstruction, setInsertLid, setInsertLidSecondary, setLidNotchSide, setPad, setSecondaryThickness, setStacked } from '../../core/edit';
import { doomExample } from '../../core/fixtures';
import { solveProject } from '../../core/layout';
import { buildCutList } from '../../core/pieces';
import { insertObj } from './obj';

describe('OBJ export', () => {
  it('writes every piece as a named solid inside the box, in millimetres', () => {
    const p = doomExample();
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    setPad(g.node, 1);
    setSecondaryThickness(p, 3);
    setInsertLid(g.node, true);
    setInsertLidSecondary(g.node, true);
    setLidNotchSide(g.node, 'front', true);
    setLidNotchSide(g.node, 'left', true);
    g.node.insert!.lidNotchSize = { width: 20, depth: 8, bottom: 0 };
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const obj = insertObj(p, s, cut);
    const lines = obj.split('\n');

    expect(lines[1]).toBe('# Units: millimetres. Y is up; the origin is the back-left corner of the box floor.');
    const objects = lines.filter((l) => l.startsWith('o '));
    expect(objects).toHaveLength(s.pieces.length);
    expect(new Set(objects).size).toBeGreaterThan(1);
    const back = s.pieces.find((x) => x.role === 'back wall' && x.depth === 0)!;
    expect(objects).toContain(`o Tray_1_piece_${cut.groupOf.get(back.id)!.number}_back_wall`);
    expect(objects.some((o) => o.startsWith('o Box_in_G_upper_piece_'))).toBe(true);
    expect(objects.filter((o) => o.endsWith('_lid'))).toHaveLength(1);
    expect(objects.find((o) => o.endsWith('_lid'))).toContain('Box_in_G_upper');
    expect(lines.filter((l) => l.startsWith('f ')).length).toBeGreaterThan(s.pieces.length * 6);

    // Every vertex lies inside the box: x across, y up, z toward the front.
    const top = p.layers.reduce((h, l) => h + l.height, 0);
    for (const l of lines.filter((x) => x.startsWith('v '))) {
      const [x, y, z] = l.slice(2).split(' ').map(Number);
      expect(x).toBeGreaterThanOrEqual(-1e-3);
      expect(x).toBeLessThanOrEqual(p.box.width + 1e-3);
      expect(y).toBeGreaterThanOrEqual(-1e-3);
      expect(y).toBeLessThanOrEqual(top + 1e-3);
      expect(z).toBeGreaterThanOrEqual(-1e-3);
      expect(z).toBeLessThanOrEqual(p.box.depth + 1e-3);
    }
  });

  it('exports separate trays too', () => {
    const p = doomExample();
    setConstruction(p, 'separate');
    const s = solveProject(p);
    const obj = insertObj(p, s, buildCutList(s, p.precision));
    expect(obj.split('\n').filter((l) => l.startsWith('o '))).toHaveLength(s.pieces.length);
  });
});

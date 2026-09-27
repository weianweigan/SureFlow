import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createDefaultProject, type SingleCavity, type CompoundCavity } from '@shared/design/types';
import { physicalCavities, normalizeProject, projectBody } from '@shared/design/cavityTree';
import { promoteFeatures, matchesMarquee } from '../selectionMath';
vi.mock('@renderer/workspace/layout/layoutStore', () => ({ useWorkspaceStore: { getState: () => ({}) } }));
import { useDesignStore } from '../designStore';
const hole = (id: string, u = 0): SingleCavity => ({ kind: 'single', instanceId: id, name: id, libraryId: 'lib', templateId: 'tpl', u, v: 2, faceId: 'top', rotation: 10, depthOffset: 0, steps: [{ type: 'straight', diameter: 8, length: 20 }] });
const compound = (id: string, u = 20): CompoundCavity => ({ kind: 'compound', instanceId: id, name: id, libraryId: 'lib', templateId: 'tpl', u, v: 30, faceId: 'top', rotation: 0, outline: { type: 'rectangle', width: 30, height: 20 } as any, children: [hole(id + '1', -5), hole(id + '2', 5)].map(({ kind, faceId, ...child }) => child) });
const fixture = () => { const doc = createDefaultProject(); doc.schemes[0].cavities = [compound('a'), hole('solo', 70), compound('b', 50)]; return doc; };
const current = () => useDesignStore.getState().projects.test;
const scheme = () => current().doc.schemes[0];
const leaves = () => physicalCavities(scheme());
describe('nested compound cavities', () => {
    beforeEach(() => { useDesignStore.setState({ projects: {} }); useDesignStore.getState().initProject('test', fixture()); });
    it('promotes children to their parent and deduplicates selection', () => {
        expect(promoteFeatures([{ type: 'cavity', id: 'a1' }, { type: 'compound', id: 'a' }, { type: 'cavity', id: 'a2' }, { type: 'cavity', id: 'solo' }], scheme())).toEqual([{ type: 'compound', id: 'a' }, { type: 'cavity', id: 'solo' }]);
    });
    it('moves roots once, keeps child offsets and supports undo/redo', () => {
        const store = useDesignStore.getState();
        store.moveRigidCavities('test', ['a1', 'a2', 'b1', 'solo'], 2.345, -1.234);
        expect(scheme().cavities.map(f => f.u)).toEqual([22.345, 72.345, 52.345]);
        expect(leaves()[1].u - leaves()[0].u).toBeCloseTo(10);
        expect(current().undoStack).toHaveLength(1);
        store.undo('test');
        expect(scheme().cavities[0].u).toBe(20);
        store.redo('test');
        expect(scheme().cavities[0].u).toBe(22.345);
    });
    it('expands only children with absolute coordinates and orientation', () => {
        const store = useDesignStore.getState();
        store.rotateCompound('test', 'a', 90);
        const c = leaves()[0];
        expect(c.instanceId).toBe('a1');
        expect(c.parentId).toBe('a');
        expect(c.u).toBeCloseTo(18);
        expect(c.v).toBeCloseTo(25);
        expect(c.rotation).toBe(100);
        expect(leaves()).toHaveLength(5);
        expect(leaves().some(c => c.instanceId === 'a')).toBe(false);
        store.rebindCompoundFace('test', 'a', 'front', 'project', { u: 40, v: 50 });
        expect(leaves()[0].faceId).toBe('front');
        expect(leaves()[0].u).toBeCloseTo(38);
        expect(leaves()[0].v).toBeCloseTo(45);
    });
    it('edits a child in local coordinates and preserves independent suppression', () => {
        const store = useDesignStore.getState();
        store.updateSubCavity('test', 'a1', { u: 7, rotation: 25, suppressed: true });
        store.toggleCompoundSuppressed('test', 'a');
        expect(leaves().slice(0, 2).every(c => c.suppressed)).toBe(true);
        store.toggleCompoundSuppressed('test', 'a');
        expect(leaves()[0].suppressed).toBe(true);
        expect(leaves()[1].suppressed).toBe(false);
        expect(leaves()[0].u).toBe(27);
        expect(leaves()[0].rotation).toBe(25);
    });
    it('copies a complete snapshot even after original deletion; delete child removes parent', () => {
        const store = useDesignStore.getState();
        store.selectFeature('test', { type: 'cavity', id: 'a1' });
        store.copySelection('test');
        store.deleteSelection('test');
        expect(scheme().cavities.map(f => f.instanceId)).toEqual(['solo', 'b']);
        store.pasteSelection('test');
        const copy = scheme().cavities[2];
        expect(copy.kind).toBe('compound');
        if (copy.kind !== 'compound')
            throw Error('compound expected');
        expect(copy.children).toHaveLength(2);
        expect(copy.children[0].instanceId).not.toBe('a1');
        expect(copy.u).toBe(30);
        store.undo('test');
        expect(scheme().cavities).toHaveLength(2);
        store.undo('test');
        expect(scheme().cavities).toHaveLength(3);
    });
    it('reorders mixed roots and children independently', () => {
        const store = useDesignStore.getState();
        store.reorderFeatures('test', 'cavity', ['b', 'solo', 'a']);
        store.reorderChildren('test', 'a', ['a2', 'a1']);
        expect(scheme().cavities.map(f => f.instanceId)).toEqual(['b', 'solo', 'a']);
        expect(leaves().map(c => c.instanceId)).toEqual(['b1', 'b2', 'solo', 'a2', 'a1']);
    });
    it('mirrors complete structures and preserves reflected child world positions and headings', () => {
        const store = useDesignStore.getState();
        store.rotateCompound('test', 'a', 35);
        const original = leaves().slice(0, 2);
        store.applyMirror('test', ['a1', 'a2'], 'u-axis', true);
        const reflected = leaves().slice(-2);
        expect(scheme().cavities).toHaveLength(4);
        reflected.forEach((c, i) => { expect(c.u).toBeCloseTo(-original[i].u); expect(c.v).toBeCloseTo(original[i].v); expect(c.rotation).toBeCloseTo(180 - original[i].rotation); });
    });
    it('patterns whole compounds with fresh parent and child IDs', () => {
        const store = useDesignStore.getState();
        store.applyLinearPattern('test', ['a1', 'a2'], { direction1: { axis: '+u', count: 3, spacing: 12 } });
        expect(scheme().cavities).toHaveLength(5);
        expect(leaves()).toHaveLength(9);
        expect(new Set(leaves().map(c => c.instanceId)).size).toBe(9);
        store.applyCircularPattern('test', ['a1'], { centerU: 0, centerV: 0, count: 4, mode: 'full' });
        expect(scheme().cavities).toHaveLength(8);
        expect(leaves()).toHaveLength(15);
    });
    it('keeps each scheme body independent including frozen input and switching', () => {
        const store = useDesignStore.getState();
        const first = current().doc.activeSchemeId;
        store.addScheme('test', 'Second');
        const second = current().doc.activeSchemeId;
        store.setBaseDimensions('test', [200, 100, 90]);
        expect(projectBody(current().doc).dimensions).toEqual([200, 100, 90]);
        store.setActiveScheme('test', first);
        expect(projectBody(current().doc).dimensions).toEqual([120, 100, 80]);
        store.setActiveScheme('test', second);
        expect(projectBody(current().doc).dimensions[0]).toBe(200);
        expect('baseBody' in current().doc).toBe(false);
        store.initProject('frozen', current().doc);
        expect(() => store.setBaseDimensions('frozen', [150, 120, 100])).not.toThrow();
        expect(projectBody(useDesignStore.getState().projects.frozen.doc).dimensions[0]).toBe(150);
    });
    it('round trips new schema; flattens legacy relationships without reconstructing', () => {
        const doc = fixture();
        expect(normalizeProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
        const old: any = { ...doc, schemaVersion: '1.0.0', baseBody: doc.schemes[0].baseBody, schemes: [{ id: 'old', name: 'Old', cavities: [{ ...hole('x'), groupId: 'old-parent' }], groups: [{ id: 'old-parent', cavityIds: ['x'], outline: {} }] }] };
        const loaded = normalizeProject(old);
        expect(loaded.schemaVersion).toBe('2.0.0');
        expect(loaded.schemes[0].cavities[0].kind).toBe('single');
        expect('groups' in loaded.schemes[0]).toBe(false);
        expect('groupId' in loaded.schemes[0].cavities[0]).toBe(false);
        expect('baseBody' in loaded).toBe(false);
    });
});
describe('directional marquee', () => { it('window excludes partial overlaps; crossing includes them', () => { const rect = { minX: 10, minY: 10, maxX: 50, maxY: 50 }, partial = { minX: 40, minY: 30, maxX: 60, maxY: 40 }; expect(matchesMarquee(partial, rect, false)).toBe(false); expect(matchesMarquee(partial, rect, true)).toBe(true); }); });

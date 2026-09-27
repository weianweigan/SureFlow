import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { buildCavityManifold } from '../../../geometry/cavityProfileBuilder';
import { createDefaultProject, type CompoundCavity, type CavityInstance } from '@shared/design/types';
import { physicalCavities } from '@shared/design/cavityTree';
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath';
import { runDesignAnalysis } from '@shared/design/analysis/analysisEngine';
import { DEFAULT_CHECK_CONFIG, type AnalysisStamp } from '@shared/design/analysis/contracts';
import { solveChannelTopology } from '@shared/design/topology/channelSolver';
const parent: CompoundCavity = {
    kind: 'compound', instanceId: 'parent', name: 'Compound', libraryId: 'lib', templateId: 'tpl',
    faceId: 'top', u: 56, v: 50, rotation: 90,
    children: [-6, 6].map((u, i) => ({ instanceId: `child-${i}`, name: `Child ${i}`, libraryId: 'lib', templateId: 'tpl', u: 0, v: -u, rotation: -90, depthOffset: 0, steps: [{ type: 'straight', diameter: 10, length: 30 }] }))
};
const baseline: CavityInstance[] = [-6, 6].map((u, i) => ({ instanceId: `child-${i}`, name: `Child ${i}`, libraryId: 'lib', templateId: 'tpl', parentId: 'parent', faceId: 'top', u: 56 + u, v: 50, rotation: 0, azimuth: 0, suppressed: false, depthOffset: 0, steps: [{ type: 'straight', diameter: 10, length: 30 }] }));
const stamp: AnalysisStamp = { sessionId: 'test', requestId: 'test', projectId: 'test', schemeId: 'test', modelRevision: 1, configRevision: 1, resourceRevision: 1, ruleSetVersion: '1', geometryPolicyVersion: '1' };
describe('compound physical geometry pipelines', () => {
    let mod: any;
    beforeAll(async () => { mod = await (Module as any)(); mod.setup(); }, 60000);
    it('matches independent-hole cuts and retains child picking IDs with no parent cut', () => {
        const doc = createDefaultProject();
        const scheme = doc.schemes[0];
        scheme.cavities = [structuredClone(parent)];
        const physical = physicalCavities(scheme);
        const cut = (holes: CavityInstance[]) => {
            const base = mod.Manifold.cube(scheme.baseBody.dimensions, false);
            const ids = new Map<number, string>();
            const cutters = holes.filter(c => !c.suppressed).map(c => {
                const profile = buildCavityManifold(mod, c.steps!, 24);
                const transformed = profile.transform(getCavityWorldMatrix(getBoxFaceBasis(c.faceId, scheme.baseBody.dimensions, scheme.baseBody), c.u, c.v, c.depthOffset, c.rotation)).asOriginal();
                profile.delete();
                ids.set(transformed.originalID(), c.instanceId);
                return transformed;
            });
            let output = base;
            for (const cutter of cutters) {
                const next = output.subtract(cutter);
                output.delete();
                output = next;
                cutter.delete();
            }
            const mesh = output.getMesh(), volume = output.volume();
            output.delete();
            return { volume, picked: [...new Set(Array.from(mesh.runOriginalID as Uint32Array).map(id => ids.get(id)).filter(Boolean))].sort() };
        };
        const nested = cut(physical), flat = cut(baseline);
        expect(nested.volume).toBeCloseTo(flat.volume, 6);
        expect(nested.picked).toEqual(['child-0', 'child-1']);
        scheme.cavities[0].suppressed = true;
        expect(cut(physicalCavities(scheme)).volume).toBeCloseTo(120 * 100 * 80, 6);
    });
    it('matches topology and wall checks; analysis reports children and exempts sibling outlines', () => {
        const doc = createDefaultProject(), scheme = doc.schemes[0];
        scheme.cavities = [structuredClone(parent)];
        const physical = physicalCavities(scheme);
        const nested = runDesignAnalysis(physical, scheme.baseBody.dimensions, scheme.baseBody, DEFAULT_CHECK_CONFIG, stamp);
        const flat = runDesignAnalysis(baseline, scheme.baseBody.dimensions, scheme.baseBody, DEFAULT_CHECK_CONFIG, stamp);
        expect(nested.issues.map(i => i.ruleId).sort()).toEqual(flat.issues.map(i => i.ruleId).sort());
        expect(nested.issues.some(i => i.ruleId === 'CLR-001')).toBe(true);
        expect(nested.issues.some(i => i.ruleId === 'OUT-001' || i.ruleId === 'OUT-002')).toBe(false);
        const topology = (holes: CavityInstance[]) => { const { computedAt, ...result } = solveChannelTopology(holes, scheme.baseBody.dimensions); return result; };
        expect(topology(physical)).toEqual(topology(baseline));
    });
});

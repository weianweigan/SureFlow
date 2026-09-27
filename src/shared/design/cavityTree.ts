import type { BaseBodyConfig, CavityFeature, CavityInstance, CompoundCavity, CompoundFrame, SchemeDefinition, SfbProject } from './types';
export const PROJECT_SCHEMA_VERSION = '2.0.0';
export function activeScheme(doc: SfbProject): SchemeDefinition {
    return doc.schemes.find(s => s.id === doc.activeSchemeId) || doc.schemes[0];
}
export function projectBody(doc: SfbProject): BaseBodyConfig;
export function projectBody(doc: SfbProject | undefined): BaseBodyConfig | undefined;
export function projectBody(doc: SfbProject | undefined): BaseBodyConfig | undefined { return doc ? activeScheme(doc).baseBody : undefined; }
export function rootFeature(scheme: {
    cavities: unknown[];
    features?: CavityFeature[];
}, id: string): CavityFeature | undefined {
    return (scheme.features || scheme.cavities as CavityFeature[]).find(f => f.instanceId === id || (f.kind === 'compound' && f.children.some(c => c.instanceId === id)));
}
export function compoundFrames(scheme?: Pick<SchemeDefinition, 'cavities'>): CompoundFrame[] {
    return (scheme?.cavities || []).filter((f): f is CompoundCavity => f.kind === 'compound').map(f => ({
        id: f.instanceId, name: f.name, cavityType: f.cavityType, faceId: f.faceId,
        u: f.u, v: f.v, rotation: f.rotation, outline: f.outline, outlineMirrored: f.outlineMirrored, suppressed: f.suppressed,
        cavityIds: f.children.map(c => c.instanceId)
    }));
}
export function physicalCavities(scheme?: Pick<SchemeDefinition, 'cavities'>): CavityInstance[] {
    return (scheme?.cavities || []).flatMap<CavityInstance>(f => {
        if (f.kind !== 'compound')
            return [f];
        const radians = f.rotation * Math.PI / 180;
        const cos = Math.cos(radians), sin = Math.sin(radians);
        return f.children.map(c => ({ ...c, faceId: f.faceId, parentId: f.instanceId,
            u: f.u + c.u * cos - c.v * sin, v: f.v + c.u * sin + c.v * cos,
            rotation: f.rotation + c.rotation,
            azimuth: f.rotation + (c.azimuth ?? c.rotation),
            suppressed: Boolean(f.suppressed || c.suppressed)
        }));
    });
}
/** Apply world-space editing inputs to a single physical hole without changing its owner. */
export function patchPhysicalCavity(scheme: SchemeDefinition, id: string, patch: Partial<CavityInstance>): void {
    const root = rootFeature(scheme, id);
    if (!root)
        return;
    if (root.kind === 'single') {
        Object.assign(root, patch);
        return;
    }
    const child = root.children.find(c => c.instanceId === id);
    if (!child)
        return;
    const current = physicalCavities({ cavities: [root] }).find(c => c.instanceId === id)!;
    const { faceId: _face, parentId: _parent, u, v, rotation, azimuth, ...rest } = patch;
    Object.assign(child, rest);
    if (u !== undefined || v !== undefined) {
        const du = (u ?? current.u) - root.u, dv = (v ?? current.v) - root.v;
        const radians = root.rotation * Math.PI / 180;
        child.u = du * Math.cos(radians) + dv * Math.sin(radians);
        child.v = -du * Math.sin(radians) + dv * Math.cos(radians);
    }
    if (rotation !== undefined)
        child.rotation = rotation - root.rotation;
    if (azimuth !== undefined)
        child.azimuth = azimuth - root.rotation;
}
export function selectedRoots(scheme: SchemeDefinition, ids: string[]): CavityFeature[] {
    return [...new Set(ids.map(id => rootFeature(scheme, id)).filter((f): f is CavityFeature => Boolean(f)))];
}
export function cloneFeature(feature: CavityFeature): CavityFeature {
    const copy = JSON.parse(JSON.stringify(feature)) as CavityFeature;
    copy.instanceId = crypto.randomUUID();
    if (copy.kind === 'compound')
        copy.children.forEach(c => { c.instanceId = crypto.randomUUID(); });
    return copy;
}
export type PhysicalScheme = Omit<SchemeDefinition, 'cavities'> & {
    features: CavityFeature[];
    cavities: CavityInstance[];
    compounds: CompoundFrame[];
};
const physicalViews = new WeakMap<SchemeDefinition, PhysicalScheme>();
export function physicalScheme(scheme: SchemeDefinition): PhysicalScheme;
export function physicalScheme(scheme: SchemeDefinition | undefined): PhysicalScheme | undefined;
export function physicalScheme(scheme: SchemeDefinition | undefined): PhysicalScheme | undefined {
    if (!scheme)
        return undefined;
    const cached = physicalViews.get(scheme);
    if (cached)
        return cached;
    const view = { ...scheme, features: scheme.cavities, cavities: physicalCavities(scheme), compounds: compoundFrames(scheme) };
    if (Object.isFrozen(scheme))
        physicalViews.set(scheme, view);
    return view;
}
/** Old flat holes remain independent; no old compound relationship is reconstructed. */
export function normalizeProject(input: SfbProject): SfbProject {
    const source = structuredClone(input) as SfbProject & {
        baseBody?: BaseBodyConfig;
    };
    const legacy = source.schemaVersion !== PROJECT_SCHEMA_VERSION;
    const schemes = source.schemes.map(s => ({
        ...s,
        baseBody: structuredClone(s.baseBody || source.baseBody!),
        cavities: s.cavities.map(f => {
            if (!legacy && f.kind === 'compound')
                return f;
            const { parentId: _parent, groupId: _group, ...single } = f as CavityInstance & {
                groupId?: string;
            };
            return { ...single, kind: 'single' as const };
        })
    })).map(({ groups: _groups, ...s }: SchemeDefinition & {
        groups?: unknown;
    }) => s);
    const { baseBody: _body, ...doc } = source;
    return { ...doc, $schema: 'https://sureflow.dev/schemas/sfb-v2.json', schemaVersion: PROJECT_SCHEMA_VERSION, schemes };
}

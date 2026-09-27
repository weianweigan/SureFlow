import { rootFeature, selectedRoots } from '@shared/design/cavityTree';
import type { CavityFeature, SchemeDefinition } from '@shared/design/types';
import type { FeatureSelectionItem } from './designStore';
export function promoteFeatures(items: FeatureSelectionItem[], scheme?: {
    cavities: unknown[];
    features?: CavityFeature[];
}): FeatureSelectionItem[] {
    const unique = new Map<string, FeatureSelectionItem>();
    for (const item of items) {
        const root = scheme && rootFeature(scheme, item.id);
        const feature: FeatureSelectionItem = root ? { type: root.kind === 'compound' ? 'compound' : 'cavity', id: root.instanceId } : item;
        unique.set(feature.id, feature);
    }
    return [...unique.values()];
}
export interface ScreenBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export function matchesMarquee(bounds: ScreenBounds, rect: ScreenBounds, crossing: boolean): boolean {
    return crossing ? bounds.maxX >= rect.minX && bounds.minX <= rect.maxX && bounds.maxY >= rect.minY && bounds.minY <= rect.maxY
        : bounds.minX >= rect.minX && bounds.maxX <= rect.maxX && bounds.minY >= rect.minY && bounds.maxY <= rect.maxY;
}
export function translateRigidSelection(scheme: SchemeDefinition, ids: string[], du: number, dv: number): void {
    selectedRoots(scheme, ids).forEach(root => { root.u += du; root.v += dv; });
}

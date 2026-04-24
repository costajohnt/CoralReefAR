export type TreeVariant = 'forked' | 'trident' | 'starburst' | 'claw' | 'wishbone';

export interface TreePolyp {
  id: number;
  variant: TreeVariant;
  seed: number;
  colorKey: string;
  parentId: number | null;     // null for root
  attachIndex: number;          // which of parent's attach points this piece claims
  attachYaw: number;            // radians around parent attach-point normal; 0 = canonical orientation
  createdAt: number;
  deviceHash?: string;          // hashed at insert, stripped on public read
  deleted: boolean;
}

export type PublicTreePolyp = Omit<TreePolyp, 'deviceHash' | 'deleted'>;

export interface AttachPoint {
  /** Local-space position on the parent mesh */
  position: { x: number; y: number; z: number };
  /** Unit normal pointing outward from the parent surface at this attach point */
  normal: { x: number; y: number; z: number };
}

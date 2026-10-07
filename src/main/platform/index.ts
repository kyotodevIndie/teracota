import { darwin } from './darwin';
import { linux } from './linux';
import type { Platform } from './types';
import { windows } from './windows';

export type { Platform } from './types';

const PLATFORMS: Partial<Record<NodeJS.Platform, Platform>> = { win32: windows, darwin, linux };

/** Sistemas sem arquivo próprio caem no Linux, o mais próximo */
export const platformFor = (os: NodeJS.Platform): Platform => PLATFORMS[os] ?? linux;

export const platform = platformFor(process.platform);

import { app } from 'electron';
import path from 'node:path';

/**
 * Pasta `assets/` (skins, ícones). No app instalado ela fica fora do .asar, em
 * resources/assets (extraResources), porque é lida via file:// e nativeImage.
 */
export function assetsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), '..', '..', 'assets'); // dev: apps/desktop → raiz do monorepo
}

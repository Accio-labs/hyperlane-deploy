import { HyperlanePermissionlessIgpDeployer } from '../src/core/HyperlanePermissionlessIgpDeployer';
import { logger } from '../src/logger';

import { run } from './run';

run('Hyperlane IGP deployment', async () => {
  logger('Preparing Hyperlane IGP deployer');
  const deployer = await HyperlanePermissionlessIgpDeployer.fromArgs();
  logger('Beginning Hyperlane deployment');
  await deployer.deploy();
});

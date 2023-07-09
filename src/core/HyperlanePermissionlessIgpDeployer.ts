import { ethers } from 'ethers';
import yargs from 'yargs';
import {
  assertBalances,
  assertBytes32,
  assertUnique,
  buildIgpConfigMap,
  getMultiProvider,
} from '../config';

import {
  ChainName,
  HyperlaneAddressesMap,
  HyperlaneContractsMap,
  HyperlaneIgpDeployer,
  MultiProvider,
  ProtocolType,
  defaultMultisigIsmConfigs,
  objMerge,
  serializeContractsMap,
} from '@hyperlane-xyz/sdk';

import { mergeJSON, tryReadJSON, } from '../json';
import { createLogger } from '../logger';

export function getArgs(multiProvider: MultiProvider) {
  // For each chain, we need:
  //   - ChainMetadata for the MultiProvider
  //   - A MultisigIsmConfig
  const { intersection } = multiProvider.intersect(
    Object.keys(defaultMultisigIsmConfigs)
  );

  return yargs(process.argv.slice(2))
    .describe('local', 'The chain to deploy to')
    .choices('local', intersection)
    .demandOption('local')
    .array('remotes')
    .describe(
      'remotes',
      "The chains with which 'local' will be able to send and receive messages",
    )
    .choices('remotes', intersection)
    .demandOption('remotes')
    .middleware(assertUnique((argv) => argv.remotes.concat(argv.local)))
    .describe('key', 'A hexadecimal private key for transaction signing')
    .string('key')
    .coerce('key', assertBytes32)
    .demandOption('key')
    .middleware(
      assertBalances(multiProvider, (argv) => argv.remotes.concat(argv.local)),
    )
    .describe('write-agent-config', 'Whether or not to write agent config')
    .default('write-agent-config', true)
    .boolean('write-agent-config').argv;
}

export class HyperlanePermissionlessIgpDeployer {
  constructor(
    public readonly multiProvider: MultiProvider,
    public readonly signer: ethers.Signer,
    public readonly local: ChainName,
    public readonly remotes: ChainName[],
    public readonly writeAgentConfig?: boolean,
    protected readonly logger = createLogger('HyperlanePermissionlessIgpDeployer'),
  ) { }

  static async fromArgs(): Promise<HyperlanePermissionlessIgpDeployer> {
    const multiProvider = getMultiProvider();
    const { local, remotes, key, writeAgentConfig } = await getArgs(
      multiProvider,
    );
    if (remotes.includes(local))
      throw new Error('Local and remotes must be distinct');
    const signer = new ethers.Wallet(key);
    multiProvider.setSharedSigner(signer);

    return new HyperlanePermissionlessIgpDeployer(
      multiProvider,
      signer,
      local,
      remotes as unknown as string[],
      writeAgentConfig,
    );
  }

  deployableChains(): ChainName[] {
    return this.remotes
      .concat([this.local])
      .filter((chain) => this.isDeployableChain(chain));
  }

  allChains(): ChainName[] {
    return this.remotes.concat([this.local]);
  }

  async deploy(): Promise<void> {
    let addresses =
      tryReadJSON<HyperlaneContractsMap<any>>(
        './artifacts',
        'addresses.json',
      ) || {};
    const owner = await this.signer.getAddress();
    const deployableChains = this.deployableChains();
    const allChains = this.allChains();

    this.logger(`Deploying IGP`);
    const igpConfig = buildIgpConfigMap(owner, deployableChains, allChains);
    const igpDeployer = new HyperlaneIgpDeployer(this.multiProvider);
    igpDeployer.cacheAddressesMap(addresses);
    const igpContracts = await igpDeployer.deploy(igpConfig);
    this.logger(`IGP deployment complete`);
    addresses = this.writeMergedAddresses(addresses, igpContracts);
  }

  writeMergedAddresses(
    aAddresses: HyperlaneAddressesMap<any>,
    bContracts: HyperlaneContractsMap<any>,
  ): HyperlaneAddressesMap<any> {
    const bAddresses = serializeContractsMap(bContracts);
    const mergedAddresses = objMerge(aAddresses, bAddresses);
    this.logger(`Writing contract addresses to artifacts/addresses.json`);
    mergeJSON('./artifacts/', 'addresses.json', mergedAddresses);
    return mergedAddresses;
  }

  isDeployableChain(chain: ChainName): boolean {
    return (
      this.multiProvider.getChainMetadata(chain).protocol ===
      ProtocolType.Ethereum
    );
  }
}

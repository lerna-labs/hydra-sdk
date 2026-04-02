import { createDiskCache } from '@lerna-labs/hydra-sdk';

export interface NotaryEntry {
  docHash: string;
  ipfsCid: string;
  txHash?: string;
  submitter: string;
  filename: string;
  timestamp: number;
}

const STAGING_DIR = process.env.IPFS_STAGING_DIR || '/ipfs-staging';

export const cache = createDiskCache<NotaryEntry>({ stagingDir: STAGING_DIR }, (entry) => entry.docHash);

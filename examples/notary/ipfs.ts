import { createIpfsClient } from '@lerna-labs/hydra-sdk';

const IPFS_API_URL = process.env.IPFS_API_URL || 'http://localhost:5001';

export const ipfs = createIpfsClient({ apiUrl: IPFS_API_URL });

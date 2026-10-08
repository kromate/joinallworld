export interface OutputRoute {
  rootParts: string[];
  assetParts: string[];
  limit: number;
}

/** Only immutable preview JSON is served; ledgers, inputs and receipts stay private. */
export function outputRoute(pathname: string): OutputRoute | null {
  if (pathname.includes('\\') || pathname.split('/').some(part => part === '.' || part === '..')) return null;
  const pack = /^\/(manifests|tiles)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (pack) return { rootParts: ['output'], assetParts: [pack[1]!, `${pack[2]}.json`], limit: pack[1] === 'manifests' ? 2_000_000 : 10_000_000 };
  const inventory = /^\/inventory\/(manifests|nodes|outlines)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (inventory) return { rootParts: ['output'], assetParts: ['inventory', inventory[1]!, `${inventory[2]}.json`], limit: inventory[1] === 'manifests' ? 1_000_000 : inventory[1] === 'nodes' ? 128_000 : 512_000 };
  const countryDirectory = /^\/country-inventory\/(manifests|nodes|outline-index|outlines|identity)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (countryDirectory) return { rootParts: ['output'], assetParts: ['country-inventory', countryDirectory[1]!, `${countryDirectory[2]}.json`],
    limit: countryDirectory[1] === 'manifests' ? 1_000_000 : countryDirectory[1] === 'nodes' || countryDirectory[1] === 'outline-index' ? 128_000 : countryDirectory[1] === 'identity' ? 256_000 : 512_000 };
  const fine = /^\/fine\/([a-z]{2})\/adm1\/(manifests|node-index|registries|coverage|outlines|topology)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (fine && fine[1] !== 'ng') return { rootParts: ['output'], assetParts: ['fine', fine[1]!, 'adm1', fine[2]!, `${fine[3]}.json`], limit: fine[2] === 'outlines' ? 2 * 1024 * 1024 : fine[2] === 'topology' ? 64 * 1024 : 128 * 1024 };
  const admin1 = /^\/admin1-foundation\/(manifests|countries|partitions|reports|indexes)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (admin1) return { rootParts: ['output'], assetParts: ['admin1-foundation', admin1[1]!, `${admin1[2]}.json`],
    limit: admin1[1] === 'partitions' ? 1024 * 1024 : admin1[1] === 'reports' || admin1[1] === 'indexes' ? 2 * 1024 * 1024 : 256 * 1024 };
  const campaign = /^\/campaigns\/([a-z0-9][a-z0-9-]{0,79})\/(manifests|tiles)\/([a-f0-9]{64})\.json$/.exec(pathname);
  if (campaign) return { rootParts: ['campaigns', campaign[1]!, 'output'], assetParts: [campaign[2]!, `${campaign[3]}.json`], limit: campaign[2] === 'manifests' ? 2_000_000 : 10_000_000 };
  return null;
}

import fs from 'fs';
import hre from 'hardhat';
import { CONTRACT_NAMES, getDeployment } from '../../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;

  const config = getDeployment(network);
  const subgraphNetwork = JSON.parse(loadJSON());

  for (const contractName of CONTRACT_NAMES) {
    subgraphNetwork[network][contractName].address = config[contractName];
  }

  saveJSON(subgraphNetwork);
}

function loadJSON() {
  const filename = `${process.env.SUBGRAPH_FOLDER}/networks.json`;
  return fs.existsSync(filename) ? fs.readFileSync(filename).toString() : '{}';
}

function saveJSON(subgraphNetwork: string) {
  const filename = `${process.env.SUBGRAPH_FOLDER}/networks.json`;
  return fs.writeFileSync(filename, JSON.stringify(subgraphNetwork, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import hre, { ethers } from 'hardhat';
import { getDeploymentProperty, ConfigProperty } from '../../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer, , , carol] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerPlatformID = await ethers.getContractAt(
    'KnowledgeLayerPlatformID',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerPlatformID),
  );

  // Whitelist Carol
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);

  // Mint Platform ID
  await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
  const carolPlatformId = await knowledgeLayerPlatformID.ids(carol.address);

  console.log(`Minted Platform ID ${carolPlatformId} for Alice`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

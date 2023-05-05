import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer, , , carol, dave] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerPlatformID = await ethers.getContractAt(
    'KnowledgeLayerPlatformID',
    getDeploymentAddress(network, 'KnowledgeLayerPlatformID'),
  );

  // Whitelist Carol
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);

  // Mint Platform IDs
  await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
  const carolPlatformId = await knowledgeLayerPlatformID.ids(carol.address);
  console.log(`Minted Platform ID ${carolPlatformId} for Carol`);

  await knowledgeLayerPlatformID.connect(dave).mint('dave-platform');
  const davePlatformId = await knowledgeLayerPlatformID.ids(dave.address);
  console.log(`Minted Platform ID ${davePlatformId} for Dave`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

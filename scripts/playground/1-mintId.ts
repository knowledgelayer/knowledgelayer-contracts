import hre, { ethers } from 'hardhat';
import { getDeploymentProperty, ConfigProperty } from '../../.deployment/deploymentManager';
import { MintStatus } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer, alice] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerID),
  );

  // Disable whitelist for reserved handles
  await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);

  // Mint ID
  await knowledgeLayerID.connect(alice).mint(0, 'alice');
  const aliceId = await knowledgeLayerID.ids(alice.address);
  console.log(`Minted ID ${aliceId} for Alice`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

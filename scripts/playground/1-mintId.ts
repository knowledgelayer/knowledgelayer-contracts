import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';
import { MintStatus } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer, alice, bob] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentAddress(network, 'KnowledgeLayerID'),
  );

  // Disable whitelist for reserved handles
  await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);

  // Mint IDs
  const tx1 = await knowledgeLayerID.connect(alice).mint(0, 'alice');
  await tx1.wait();

  const aliceId = await knowledgeLayerID.ids(alice.address);
  console.log(`Minted ID ${aliceId} for Alice`);

  const tx2 = await knowledgeLayerID.connect(bob).mint(0, 'bob__');
  await tx2.wait();

  const bobId = await knowledgeLayerID.ids(bob.address);
  console.log(`Minted ID ${bobId} for Bob`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

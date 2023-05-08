import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, alice] = await ethers.getSigners();

  // Get contract
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentAddress(network, 'KnowledgeLayerID'),
  );

  const knowledgeLayerEscrow = await ethers.getContractAt(
    'KnowledgeLayerEscrow',
    getDeploymentAddress(network, 'KnowledgeLayerEscrow'),
  );

  // Buy course
  const transactionId = 1;
  const aliceId = await knowledgeLayerID.connect(alice).ids(alice.address);
  const tx = await knowledgeLayerEscrow.connect(alice).release(aliceId, transactionId);
  await tx.wait();

  console.log('Released payment for transaction with id: ', transactionId);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

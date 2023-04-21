import hre, { ethers } from 'hardhat';
import { ConfigProperty, setDeploymentProperty } from '../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer] = await ethers.getSigners();
  console.log('Using address: ', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance: ', ethers.utils.formatEther(balance));

  const KnowledgeLayerPlatformID = await ethers.getContractFactory('KnowledgeLayerPlatformID');
  const knowledgeLayerPlatformId = await KnowledgeLayerPlatformID.deploy();
  await knowledgeLayerPlatformId.deployed();

  console.log('Deployed KnowledgeLayerPlatformID at', knowledgeLayerPlatformId.address);
  setDeploymentProperty(
    network,
    ConfigProperty.KnowledgeLayerPlatformID,
    knowledgeLayerPlatformId.address,
  );

  const KnowledgeLayerID = await ethers.getContractFactory('KnowledgeLayerID');
  const knowledgeLayerId = await KnowledgeLayerID.deploy(knowledgeLayerPlatformId.address);
  await knowledgeLayerId.deployed();

  console.log('Deployed KnowledgeLayerID at', knowledgeLayerId.address);
  setDeploymentProperty(network, ConfigProperty.KnowledgeLayerID, knowledgeLayerId.address);

  const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
  const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy(knowledgeLayerId.address);
  await knowledgeLayerCourse.deployed();

  console.log('Deployed KnowledgeLayerCourse at', knowledgeLayerCourse.address);
  setDeploymentProperty(network, ConfigProperty.KnowledgeLayerCourse, knowledgeLayerCourse.address);

  const KnowledgeLayerEscrow = await ethers.getContractFactory('KnowledgeLayerEscrow');
  const knowledgeLayerEscrow = await KnowledgeLayerEscrow.deploy(
    knowledgeLayerId.address,
    knowledgeLayerCourse.address,
  );
  await knowledgeLayerEscrow.deployed();

  console.log('Deployed KnowledgeLayerEscrow at', knowledgeLayerEscrow.address);
  setDeploymentProperty(network, ConfigProperty.KnowledgeLayerEscrow, knowledgeLayerEscrow.address);

  const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
  await knowledgeLayerCourse.grantRole(escrowRole, knowledgeLayerEscrow.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

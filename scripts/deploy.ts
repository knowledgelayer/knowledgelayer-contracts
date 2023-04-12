import hre, { ethers } from 'hardhat';
import { ConfigProperty, setDeploymentProperty } from '../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [deployer] = await ethers.getSigners();
  console.log('Using address: ', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance: ', ethers.utils.formatEther(balance));

  const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
  const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy();
  await knowledgeLayerCourse.deployed();

  console.log('Deployed KnowledgeLayer at', knowledgeLayerCourse.address);
  setDeploymentProperty(network, ConfigProperty.KnowledgeLayerCourse, knowledgeLayerCourse.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

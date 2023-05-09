import { setDeploymentAddress } from '../../.deployment/deploymentManager';
import { verifyAddress } from '../../utils/verifyAddress';
import { task } from 'hardhat/config';

task('deploy', 'Deploy all contracts')
  .addFlag('verify', 'verify contracts on etherscan')
  .setAction(async (args, { ethers, network }) => {
    const { verify } = args;
    console.log('Network:', network.name);

    const [deployer] = await ethers.getSigners();
    console.log('Using address: ', deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log('Balance: ', ethers.utils.formatEther(balance));

    // Deploy KnowledgeLayerCourse
    const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
    const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy();
    await knowledgeLayerCourse.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerCourse.address);
    }

    console.log('Deployed KnowledgeLayerCourse at', knowledgeLayerCourse.address);
    setDeploymentAddress(network.name, 'KnowledgeLayerCourse', knowledgeLayerCourse.address);
  });

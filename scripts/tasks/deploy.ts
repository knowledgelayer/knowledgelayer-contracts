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

    // Deploy KnowledgeLayerPlatformID
    const KnowledgeLayerPlatformID = await ethers.getContractFactory('KnowledgeLayerPlatformID');
    const knowledgeLayerPlatformID = await KnowledgeLayerPlatformID.deploy();
    await knowledgeLayerPlatformID.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerPlatformID.address);
    }

    console.log('Deployed KnowledgeLayerPlatformID at', knowledgeLayerPlatformID.address);
    setDeploymentAddress(
      network.name,
      'KnowledgeLayerPlatformID',
      knowledgeLayerPlatformID.address,
    );

    // Deploy KnowledgeLayerID
    const KnowledgeLayerID = await ethers.getContractFactory('KnowledgeLayerID');
    const knowledgeLayerIDconstructorArgs: [string] = [knowledgeLayerPlatformID.address];
    const knowledgeLayerID = await KnowledgeLayerID.deploy(...knowledgeLayerIDconstructorArgs);
    await knowledgeLayerID.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerID.address, knowledgeLayerIDconstructorArgs);
    }

    console.log('Deployed KnowledgeLayerID at', knowledgeLayerID.address);
    setDeploymentAddress(network.name, 'KnowledgeLayerID', knowledgeLayerID.address);

    // Deploy KnowledgeLayerCourse
    const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
    const knowledgeLayerCourseArgs: [string] = [knowledgeLayerID.address];
    const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy(...knowledgeLayerCourseArgs);
    await knowledgeLayerCourse.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerCourse.address, knowledgeLayerCourseArgs);
    }

    console.log('Deployed KnowledgeLayerCourse at', knowledgeLayerCourse.address);
    setDeploymentAddress(network.name, 'KnowledgeLayerCourse', knowledgeLayerCourse.address);

    // Deploy KnowledgeLayerEscrow
    const KnowledgeLayerEscrow = await ethers.getContractFactory('KnowledgeLayerEscrow');
    const knowledgeLayerEscrowArgs: [string, string, string, string] = [
      knowledgeLayerID.address,
      knowledgeLayerPlatformID.address,
      knowledgeLayerCourse.address,
      deployer.address,
    ];
    const knowledgeLayerEscrow = await KnowledgeLayerEscrow.deploy(...knowledgeLayerEscrowArgs);
    await knowledgeLayerEscrow.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerEscrow.address, knowledgeLayerEscrowArgs);
    }

    console.log('Deployed KnowledgeLayerEscrow at', knowledgeLayerEscrow.address);
    setDeploymentAddress(network.name, 'KnowledgeLayerEscrow', knowledgeLayerEscrow.address);

    // Grant esrow role to KnowledgeLayerEscrow
    const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
    await knowledgeLayerCourse.grantRole(escrowRole, knowledgeLayerEscrow.address);

    // Deploy KnowledgeLayerReview
    const KnowledgeLayerReview = await ethers.getContractFactory('KnowledgeLayerReview');
    const knowledgeLayerReviewArgs: [string, string] = [
      knowledgeLayerID.address,
      knowledgeLayerCourse.address,
    ];
    const knowledgeLayerReview = await KnowledgeLayerReview.deploy(...knowledgeLayerReviewArgs);
    await knowledgeLayerReview.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerReview.address, knowledgeLayerReviewArgs);
    }

    console.log('Deployed KnowledgeLayerReview at', knowledgeLayerReview.address);
    setDeploymentAddress(network.name, 'KnowledgeLayerReview', knowledgeLayerReview.address);
  });

import { ConfigProperty, setDeploymentProperty } from '../../.deployment/deploymentManager';
import { MintStatus } from '../../utils/constants';
import { verifyAddress } from '../../utils/verifyAddress';
import { task } from 'hardhat/config';

task('deploy', 'Deploy all contracts')
  .addFlag('verify', 'verify contracts on etherscan')
  .setAction(async (args, { ethers, network }) => {
    const { verify } = args;
    console.log('Network:', network.name);

    const [deployer, alice, bob, carol, dave] = await ethers.getSigners();
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
    setDeploymentProperty(
      network.name,
      ConfigProperty.KnowledgeLayerPlatformID,
      knowledgeLayerPlatformID.address,
    );

    // Deploy KnowledgeLayerID
    const KnowledgeLayerID = await ethers.getContractFactory('KnowledgeLayerID');
    const knowledgeLayerID = await KnowledgeLayerID.deploy(knowledgeLayerPlatformID.address);
    await knowledgeLayerID.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerID.address, [knowledgeLayerPlatformID.address]);
    }

    console.log('Deployed KnowledgeLayerID at', knowledgeLayerID.address);
    setDeploymentProperty(network.name, ConfigProperty.KnowledgeLayerID, knowledgeLayerID.address);

    // Deploy KnowledgeLayerCourse
    const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
    const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy(knowledgeLayerID.address);
    await knowledgeLayerCourse.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerCourse.address, [knowledgeLayerID.address]);
    }

    console.log('Deployed KnowledgeLayerCourse at', knowledgeLayerCourse.address);
    setDeploymentProperty(
      network.name,
      ConfigProperty.KnowledgeLayerCourse,
      knowledgeLayerCourse.address,
    );

    // Deploy KnowledgeLayerEscrow
    const KnowledgeLayerEscrow = await ethers.getContractFactory('KnowledgeLayerEscrow');
    const knowledgeLayerEscrow = await KnowledgeLayerEscrow.deploy(
      knowledgeLayerID.address,
      knowledgeLayerPlatformID.address,
      knowledgeLayerCourse.address,
    );
    await knowledgeLayerEscrow.deployed();

    if (verify) {
      await verifyAddress(knowledgeLayerEscrow.address, [
        knowledgeLayerID.address,
        knowledgeLayerPlatformID.address,
        knowledgeLayerCourse.address,
      ]);
    }

    console.log('Deployed KnowledgeLayerEscrow at', knowledgeLayerEscrow.address);
    setDeploymentProperty(
      network.name,
      ConfigProperty.KnowledgeLayerEscrow,
      knowledgeLayerEscrow.address,
    );

    // Grant esrow role to KnowledgeLayerEscrow
    const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
    await knowledgeLayerCourse.grantRole(escrowRole, knowledgeLayerEscrow.address);

    // Add carol to whitelist and mint platform IDs
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    await knowledgeLayerPlatformID.connect(dave).mint('dave-platform');

    // Disable whitelist and mint IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(0, 'alice');
    await knowledgeLayerID.connect(bob).mint(0, 'bob__');
  });

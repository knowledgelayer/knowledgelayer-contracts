import hre, { ethers } from 'hardhat';
import { getDeploymentProperty, ConfigProperty } from '../../.deployment/deploymentManager';
import { FEE_DIVIDER } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, , bob] = await ethers.getSigners();

  // Get contract
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerID),
  );

  const knowledgeLayerPlatformID = await ethers.getContractAt(
    'KnowledgeLayerPlatformID',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerPlatformID),
  );

  const knowledgeLayerCourse = await ethers.getContractAt(
    'KnowledgeLayerCourse',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerCourse),
  );

  const knowledgeLayerEscrow = await ethers.getContractAt(
    'KnowledgeLayerEscrow',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerEscrow),
  );

  // Buy course
  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.00000001');
  const buyPlatformId = 2;

  const course = await knowledgeLayerCourse.getCourse(courseId);
  const originFee = await knowledgeLayerPlatformID.getOriginFee(course.platformId);
  const buyFee = await knowledgeLayerPlatformID.getBuyFee(buyPlatformId);
  const protocolFee = await knowledgeLayerEscrow.protocolFee();
  const totalPrice = coursePrice.add(
    coursePrice.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
  );

  const bobId = await knowledgeLayerID.ids(bob.address);
  const tx = await knowledgeLayerEscrow
    .connect(bob)
    .createTransaction(bobId, courseId, buyPlatformId, {
      value: totalPrice,
    });
  await tx.wait();

  console.log('Bought course with id: ', courseId);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

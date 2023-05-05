import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';
import { FEE_DIVIDER } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, , bob] = await ethers.getSigners();

  // Get contract
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentAddress(network, 'KnowledgeLayerID'),
  );

  const knowledgeLayerPlatformID = await ethers.getContractAt(
    'KnowledgeLayerPlatformID',
    getDeploymentAddress(network, 'KnowledgeLayerPlatformID'),
  );

  const knowledgeLayerCourse = await ethers.getContractAt(
    'KnowledgeLayerCourse',
    getDeploymentAddress(network, 'KnowledgeLayerCourse'),
  );

  const knowledgeLayerEscrow = await ethers.getContractAt(
    'KnowledgeLayerEscrow',
    getDeploymentAddress(network, 'KnowledgeLayerEscrow'),
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

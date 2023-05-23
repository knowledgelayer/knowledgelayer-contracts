import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';
import uploadToIPFS from '../../utils/uploadToIpfs';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, , bob] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerReview = await ethers.getContractAt(
    'KnowledgeLayerReview',
    getDeploymentAddress(network, 'KnowledgeLayerReview'),
  );

  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentAddress(network, 'KnowledgeLayerID'),
  );

  // Upload review data to IPFS
  const rating = 5;
  const courseData = {
    content: 'This course is amazing',
    rating,
  };
  const dataUri = await uploadToIPFS(courseData);
  if (!dataUri) throw new Error('Failed to upload to IPFS');

  // Create course
  const courseId = 1;
  const bobId = await knowledgeLayerID.connect(bob).ids(bob.address);

  const tx = await knowledgeLayerReview.connect(bob).mint(bobId, courseId, dataUri, rating);
  const receipt = await tx.wait();

  const id = receipt.events?.find((e) => e.event === 'Mint')?.args?.id;
  console.log('Created new review with id: ', id);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

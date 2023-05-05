import hre, { ethers } from 'hardhat';
import { getDeploymentProperty, ConfigProperty } from '../../.deployment/deploymentManager';
import uploadToIPFS from '../../utils/uploadToIpfs';
import { ETH_ADDRESS } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, alice] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerID),
  );

  const knowledgeLayerCourse = await ethers.getContractAt(
    'KnowledgeLayerCourse',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerCourse),
  );

  // Upload course data to IPFS
  const courseData = {
    title: 'My cool course',
    description:
      'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
    image:
      'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
    videoPlaybackId: 'a915y3226a68zhp7',
  };
  const dataUri = await uploadToIPFS(courseData);
  if (!dataUri) throw new Error('Failed to upload to IPFS');

  // Create course
  const coursePrice = ethers.utils.parseEther('0.00000001');
  const platformId = 1;
  const aliceId = await knowledgeLayerID.connect(alice).ids(alice.address);

  const tx = await knowledgeLayerCourse
    .connect(alice)
    .createCourse(aliceId, platformId, coursePrice, ETH_ADDRESS, dataUri);
  const receipt = await tx.wait();

  const id = receipt.events?.find((e) => e.event === 'CourseCreated')?.args?.courseId;
  console.log('Created new course with id: ', id);

  const course = await knowledgeLayerCourse.courses(0);
  console.log('Course: ', course);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

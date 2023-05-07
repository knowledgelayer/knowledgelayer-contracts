import hre, { ethers } from 'hardhat';
import { getDeploymentAddress } from '../../.deployment/deploymentManager';
import uploadToIPFS from '../../utils/uploadToIpfs';
import { ETH_ADDRESS } from '../../utils/constants';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, alice] = await ethers.getSigners();

  // Get contracts
  const knowledgeLayerID = await ethers.getContractAt(
    'KnowledgeLayerID',
    getDeploymentAddress(network, 'KnowledgeLayerID'),
  );

  const knowledgeLayerCourse = await ethers.getContractAt(
    'KnowledgeLayerCourse',
    getDeploymentAddress(network, 'KnowledgeLayerCourse'),
  );

  // Upload course data to IPFS
  const courseData = {
    title: 'Web3 Development 101',
    about:
      'This course will teach you the basics of web3 development. You will learn how to build a simple smart contract and how to interact with it using a web3 provider.',
    // description: 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
    image_url:
      'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/smart-contract-dev-cover.png',
    keywords: 'web3,solidity',
    lessons: [
      {
        title: 'Lesson 1: Introduction to Smart Contracts',
        about: 'In this lesson you will learn what a smart contract is and how it works.',
        videoPlaybackId: '85f5y6aygrxlmhxn',
      },
    ],
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

import hre, { ethers } from 'hardhat';
import { getDeploymentProperty, ConfigProperty } from '../../.deployment/deploymentManager';

async function main() {
  const network = hre.network.name;
  console.log('Network:', network);

  const [, alice] = await ethers.getSigners();

  // Get contract
  const knowledgeLayerCourse = await ethers.getContractAt(
    'KnowledgeLayerCourse',
    getDeploymentProperty(network, ConfigProperty.KnowledgeLayerCourse),
  );

  // Set data
  const price = ethers.utils.parseEther('0.00000001');
  const title = 'Test';
  const slug = 'test';
  const description =
    'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!';
  const image =
    'https://www.smartpassiveincome.com/wp-content/uploads/2020/04/How-to-Create-an-Online-Course.png';
  const videoPlaybackId = 'a915y3226a68zhp7';

  const tx = await knowledgeLayerCourse
    .connect(alice)
    .createCourse(title, slug, description, price, image, videoPlaybackId);
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

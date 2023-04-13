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
  const courses = [
    {
      title: 'ChatGPT Complete Guide: Learn Midjourney, ChatGPT 4 & More',
      slug: 'chatgpt-complete-guide',
      description:
        'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
      price: ethers.utils.parseEther('1'),
      image:
        'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
      videoPlaybackId: 'a915y3226a68zhp7',
    },
    {
      title: 'Web Development Bootcamp',
      slug: 'chatgpt-complete-guide-2',
      description:
        'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
      price: ethers.utils.parseEther('1'),
      image:
        'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
      videoPlaybackId: 'a915y3226a68zhp7',
    },
    {
      title: 'Complete Social Media Marketing Bootcamp',
      slug: 'chatgpt-complete-guide-3',
      description:
        'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
      price: ethers.utils.parseEther('1'),
      image:
        'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
      videoPlaybackId: 'a915y3226a68zhp7',
    },
    {
      title: 'Cooking Masterclass: Become a Chef in 10 Steps',
      slug: 'chatgpt-complete-guide-4',
      description:
        'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
      price: ethers.utils.parseEther('1'),
      image:
        'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
      videoPlaybackId: 'a915y3226a68zhp7',
    },
  ];

  for (const course of courses) {
    const { title, slug, description, price, image, videoPlaybackId } = course;

    const tx = await knowledgeLayerCourse
      .connect(alice)
      .createCourse(title, slug, description, price, image, videoPlaybackId);
    await tx.wait();
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

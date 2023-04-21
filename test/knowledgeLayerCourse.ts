import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import uploadToIPFS from '../utils/uploadToIpfs';
import deploy from '../utils/deploy';
import { MintStatus } from '../utils/constants';

describe('KnowledgeLayerCourse', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    aliceId: BigNumber,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse;

  const courseData = {
    title: 'My cool course',
    description:
      'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
    image:
      'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
    videoPlaybackId: 'a915y3226a68zhp7',
  };

  const courseId = 1;
  const coursePrice = 100;

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

    // Disable whitelist and mint ID
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(0, 'alice');
    aliceId = await knowledgeLayerID.connect(alice).ids(alice.address);
  });

  describe('Create course', async () => {
    let dataUri: string;

    before(async () => {
      const uri = await uploadToIPFS(courseData);
      if (!uri) throw new Error('Failed to upload to IPFS');
      dataUri = uri;

      // Alice creates a course
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .createCourse(aliceId, carolPlatformId, coursePrice, dataUri);
      await tx.wait();
    });

    it('Creates course with the correct data', async () => {
      const course = await knowledgeLayerCourse.courses(courseId);
      expect(course.ownerId).to.equal(aliceId);
      expect(course.platformId).to.equal(carolPlatformId);
      expect(course.price).to.equal(coursePrice);
      expect(course.dataUri).to.equal(dataUri);
    });
  });

  describe('Buy course', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Bob buys Alice's course
      tx = await knowledgeLayerCourse.connect(bob).buyCourse(courseId, {
        value: coursePrice,
      });
      await tx.wait();
    });

    it('Mints a course token to Bob', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });

    it("Sends Bob's money to Alice and fee to owner", async () => {
      const fee = coursePrice * 0.05;
      await expect(tx).to.changeEtherBalances(
        [bob, alice, deployer],
        [-coursePrice, coursePrice - fee, fee],
      );
    });
  });

  describe('Update course price', async () => {
    const newPrice = 200;

    before(async () => {
      // Alice updates her course price
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .updateCoursePrice(aliceId, courseId, newPrice);
      await tx.wait();
    });

    it('Updates the course price', async () => {
      const price = (await knowledgeLayerCourse.courses(courseId)).price;
      expect(price).to.equal(newPrice);
    });

    it('Only the owner can update the course price', async () => {
      const tx = knowledgeLayerCourse.connect(bob).updateCoursePrice(aliceId, courseId, newPrice);
      expect(tx).to.be.revertedWith('Only seller can update price');
    });
  });

  describe('Token transfers', async () => {
    it("Tokens can't be transferred", async () => {
      const tx = knowledgeLayerCourse
        .connect(bob)
        .safeTransferFrom(bob.address, alice.address, courseId, 1, []);

      await expect(tx).to.be.revertedWith('Token transfer is not allowed');

      const tx2 = knowledgeLayerCourse
        .connect(bob)
        .safeBatchTransferFrom(bob.address, alice.address, [courseId], [1], []);

      await expect(tx2).to.be.revertedWith('Token transfer is not allowed');
    });
  });
});
